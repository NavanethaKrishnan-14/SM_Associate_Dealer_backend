import { randomUUID } from "node:crypto";
import { Router } from "express";
import { v2 as cloudinary } from "cloudinary";
import { z } from "zod";
import { env } from "../../config/env.js";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { Dealer, Car, CarImage } from "../../lib/mongo.js";
export const dealerImagesRouter=Router();
dealerImagesRouter.use(authenticate,requireRole("DEALER"));
const imageSchema=z.object({imageUrl:z.string().url().max(2048),publicId:z.string().trim().min(3).max(500),isCover:z.boolean().default(false),sortOrder:z.coerce.number().int().min(0).max(20).default(0)});
function cloudinaryConfig(){const {CLOUDINARY_CLOUD_NAME,CLOUDINARY_API_KEY,CLOUDINARY_API_SECRET}=env;if(!CLOUDINARY_CLOUD_NAME||!CLOUDINARY_API_KEY||!CLOUDINARY_API_SECRET)throw new HttpError(503,"Cloud image storage is not configured. Contact the platform administrator.","IMAGE_STORAGE_NOT_CONFIGURED");return {cloudName:CLOUDINARY_CLOUD_NAME,apiKey:CLOUDINARY_API_KEY,apiSecret:CLOUDINARY_API_SECRET};}
async function ownedCar(carId:string|undefined,userId:string){const parsed=z.string().uuid().safeParse(carId);if(!parsed.success)throw new HttpError(400,"The car ID is invalid.","INVALID_CAR_ID");const dealer=await Dealer.findOne({userId});if(!dealer)throw new HttpError(403,"A dealer profile is required.","DEALER_PROFILE_REQUIRED");const car=await Car.findOne({_id:parsed.data,dealerId:dealer.id});if(!car)throw new HttpError(404,"Vehicle not found in your inventory.","CAR_NOT_FOUND");if(["SOLD","ARCHIVED"].includes(car.status))throw new HttpError(409,"Images cannot be changed for a sold or archived vehicle.","CAR_NOT_EDITABLE");return car;}
dealerImagesRouter.post("/:carId/images/signature",asyncHandler(async(req,res)=>{
 const car=await ownedCar(req.params.carId,req.auth!.userId);if(await CarImage.countDocuments({carId:car.id})>=12)throw new HttpError(409,"A listing can contain at most 12 photos.","IMAGE_LIMIT_REACHED");
 const cfg=cloudinaryConfig(),timestamp=Math.floor(Date.now()/1000),folder=`sm-associate-cars/cars/${car.id}`,publicId=`${car.id}_${randomUUID()}`;
 const signature=cloudinary.utils.api_sign_request({folder,public_id:publicId,timestamp},cfg.apiSecret);
 res.status(200).json({success:true,data:{cloudName:cfg.cloudName,apiKey:cfg.apiKey,timestamp,folder,publicId,signature,uploadUrl:`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`,maxFileBytes:10*1024*1024,allowedFormats:["jpg","jpeg","png","webp"]}});
}));
dealerImagesRouter.post("/:carId/images",asyncHandler(async(req,res)=>{
 const car=await ownedCar(req.params.carId,req.auth!.userId),parsed=imageSchema.safeParse(req.body);
 if(!parsed.success){res.status(400).json({success:false,error:{code:"VALIDATION_ERROR",message:"Check the uploaded image details.",details:parsed.error.flatten().fieldErrors}});return;}
 const cfg=cloudinaryConfig();let url:URL;try{url=new URL(parsed.data.imageUrl);}catch{throw new HttpError(400,"The image URL is invalid.","INVALID_IMAGE_URL");}
 const prefix=`/${cfg.cloudName}/image/upload/`,folder=`/sm-associate-cars/cars/${car.id}/`,last=parsed.data.publicId.split("/").pop()??"";
 if(url.protocol!=="https:"||url.hostname!=="res.cloudinary.com"||!url.pathname.startsWith(prefix)||!url.pathname.includes(`${folder}${last}.`)||!last.startsWith(`${car.id}_`)||!/^[0-9a-f-]{36}$/i.test(last.slice(car.id.length+1)))throw new HttpError(400,"The image must belong to this car's signed Cloudinary upload.","UNTRUSTED_IMAGE");
 const count=await CarImage.countDocuments({carId:car.id});if(count>=12)throw new HttpError(409,"A listing can contain at most 12 photos.","IMAGE_LIMIT_REACHED");
 const isCover=parsed.data.isCover||count===0;if(isCover)await CarImage.updateMany({carId:car.id},{$set:{isCover:false}});
 const image=await CarImage.create({carId:car.id,imageUrl:parsed.data.imageUrl,publicId:parsed.data.publicId,isCover,sortOrder:parsed.data.sortOrder});
 res.status(201).json({success:true,data:{id:image.id,imageUrl:image.imageUrl,publicId:image.publicId,isCover:image.isCover,sortOrder:image.sortOrder}});
}));
dealerImagesRouter.delete("/:carId/images/:imageId",asyncHandler(async(req,res)=>{
 const car=await ownedCar(req.params.carId,req.auth!.userId),parsed=z.string().uuid().safeParse(req.params.imageId);if(!parsed.success)throw new HttpError(400,"The image ID is invalid.","INVALID_IMAGE_ID");
 const image=await CarImage.findOne({_id:parsed.data,carId:car.id});if(!image)throw new HttpError(404,"Image not found for this vehicle.","IMAGE_NOT_FOUND");
 const cfg=cloudinaryConfig();cloudinary.config({cloud_name:cfg.cloudName,api_key:cfg.apiKey,api_secret:cfg.apiSecret,secure:true});
 const destroyed=await cloudinary.uploader.destroy(image.publicId,{resource_type:"image"});if(destroyed.result!=="ok"&&destroyed.result!=="not found")throw new HttpError(502,"The image could not be removed from cloud storage.","IMAGE_DELETE_FAILED");
 await image.deleteOne();if(image.isCover){const next=await CarImage.findOne({carId:car.id}).sort({sortOrder:1});if(next){next.isCover=true;await next.save();}}
 res.status(200).json({success:true,data:{id:image.id},message:"Image removed."});
}));
