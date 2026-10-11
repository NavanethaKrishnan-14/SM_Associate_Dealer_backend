import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { User, Dealer, Brand, CarModel, Car, CarImage } from "../../lib/mongo.js";
export const dealerCarsRouter=Router();
dealerCarsRouter.use(authenticate,requireRole("DEALER"));
const fuelTypeSchema=z.enum(["PETROL","DIESEL","CNG","ELECTRIC","HYBRID"]);
const transmissionSchema=z.enum(["MANUAL","AUTOMATIC"]);
const yearSchema=z.coerce.number().int().min(1950).max(new Date().getFullYear()+1);
const createCarSchema=z.object({brand:z.string().trim().min(1).max(60),model:z.string().trim().min(1).max(60),variant:z.string().trim().max(100).optional(),title:z.string().trim().min(3).max(160).optional(),description:z.string().trim().max(5000).optional(),priceInr:z.coerce.number().positive().max(100_000_000),manufacturingYear:yearSchema,registrationYear:yearSchema.optional(),mileageKm:z.coerce.number().int().min(0).max(2_000_000),fuelType:fuelTypeSchema,transmission:transmissionSchema,bodyType:z.string().trim().max(60).optional(),color:z.string().trim().max(60).optional(),ownershipCount:z.coerce.number().int().min(1).max(20).optional(),registrationState:z.string().trim().max(60).optional(),insuranceValidTill:z.coerce.date().optional(),city:z.string().trim().min(2).max(100).optional(),state:z.string().trim().min(2).max(100).default("Tamil Nadu")});
const updateCarSchema=z.object({variant:z.string().trim().max(100).nullable().optional(),title:z.string().trim().min(3).max(160).optional(),description:z.string().trim().max(5000).nullable().optional(),priceInr:z.coerce.number().positive().max(100_000_000).optional(),manufacturingYear:yearSchema.optional(),registrationYear:yearSchema.nullable().optional(),mileageKm:z.coerce.number().int().min(0).max(2_000_000).optional(),fuelType:fuelTypeSchema.optional(),transmission:transmissionSchema.optional(),bodyType:z.string().trim().max(60).nullable().optional(),color:z.string().trim().max(60).nullable().optional(),ownershipCount:z.coerce.number().int().min(1).max(20).nullable().optional(),registrationState:z.string().trim().max(60).nullable().optional(),insuranceValidTill:z.coerce.date().nullable().optional(),city:z.string().trim().min(2).max(100).optional(),state:z.string().trim().min(2).max(100).optional()}).refine(v=>Object.values(v).some(x=>x!==undefined),{message:"Provide at least one field to update."});
const listQuerySchema=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(50).default(20),status:z.enum(["DRAFT","PENDING_APPROVAL","AVAILABLE","RESERVED","SOLD","REJECTED","ARCHIVED"]).optional()});
const statusSchema=z.object({status:z.enum(["DRAFT","PENDING_APPROVAL","RESERVED","SOLD","ARCHIVED"])});
const slugify=(s:string)=>s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
async function requireDealerProfile(userId:string){const d=await Dealer.findOne({userId});if(!d)throw new HttpError(403,"A dealer profile is required to manage inventory.","DEALER_PROFILE_REQUIRED");return d;}
function parseId(value:string|undefined){const p=z.string().uuid().safeParse(value);if(!p.success)throw new HttpError(400,"The car ID is invalid.","INVALID_CAR_ID");return p.data;}
async function shape(car:any){const [brand,model,images]=await Promise.all([Brand.findById(car.brandId).lean(),CarModel.findById(car.modelId).lean(),CarImage.find({carId:car.id??car._id}).select("imageUrl isCover sortOrder").sort({isCover:-1,sortOrder:1}).lean()]);return {id:String(car._id??car.id),title:car.title,variant:car.variant??null,description:car.description??null,priceInr:String(car.priceInr),status:car.status,manufacturingYear:car.manufacturingYear,registrationYear:car.registrationYear??null,mileageKm:car.mileageKm,fuelType:car.fuelType,transmission:car.transmission,color:car.color??null,city:car.city,state:car.state,images:images.map((i:any)=>({id:String(i._id),imageUrl:i.imageUrl,isCover:i.isCover,sortOrder:i.sortOrder})),brand:brand?{id:String(brand._id),name:brand.name,slug:brand.slug}:null,model:model?{id:String(model._id),name:model.name,slug:model.slug}:null,createdAt:car.createdAt,updatedAt:car.updatedAt};}
dealerCarsRouter.get("/",asyncHandler(async(req,res)=>{
 const q=listQuerySchema.safeParse(req.query);if(!q.success){res.status(400).json({success:false,error:{code:"INVALID_QUERY",message:"Invalid inventory filters.",details:q.error.flatten().fieldErrors}});return;}
 const d=await requireDealerProfile(req.auth!.userId);const {page,limit,status}=q.data;const filter:any={dealerId:d.id,...(status?{status}:{})};
 const [items,total]=await Promise.all([Car.find(filter).sort({updatedAt:-1}).skip((page-1)*limit).limit(limit).lean(),Car.countDocuments(filter)]);
 res.status(200).json({success:true,data:await Promise.all(items.map((c:any)=>shape(c))),pagination:{page,limit,total,totalPages:Math.ceil(total/limit)}});
}));
dealerCarsRouter.post("/",asyncHandler(async(req,res)=>{
 const p=createCarSchema.safeParse(req.body);if(!p.success){res.status(400).json({success:false,error:{code:"VALIDATION_ERROR",message:"Check the vehicle details.",details:p.error.flatten().fieldErrors}});return;}
 const d=await requireDealerProfile(req.auth!.userId);const data=p.data;const brandName=data.brand.trim(),modelName=data.model.trim(),brandSlug=slugify(brandName),modelSlug=slugify(modelName);
 if(!brandSlug||!modelSlug)throw new HttpError(400,"Enter a valid vehicle brand and model.","INVALID_BRAND_OR_MODEL");
 let brand=await Brand.findOne({slug:brandSlug});if(!brand){try{brand=await Brand.create({name:brandName,slug:brandSlug});}catch{brand=await Brand.findOne({slug:brandSlug});}}
 if(!brand)throw new HttpError(500,"Unable to save vehicle brand.","BRAND_SAVE_FAILED");
 let model=await CarModel.findOne({brandId:brand.id,slug:modelSlug});if(!model){try{model=await CarModel.create({brandId:brand.id,name:modelName,slug:modelSlug});}catch{model=await CarModel.findOne({brandId:brand.id,slug:modelSlug});}}
 if(!model)throw new HttpError(500,"Unable to save vehicle model.","MODEL_SAVE_FAILED");
 const car=await Car.create({dealerId:d.id,brandId:brand.id,modelId:model.id,title:data.title??[brand.name,model.name,data.variant].filter(Boolean).join(" "),...(data.variant!==undefined?{variant:data.variant}:{}),...(data.description!==undefined?{description:data.description}:{}),priceInr:data.priceInr,manufacturingYear:data.manufacturingYear,...(data.registrationYear!==undefined?{registrationYear:data.registrationYear}:{}),mileageKm:data.mileageKm,fuelType:data.fuelType,transmission:data.transmission,...(data.bodyType!==undefined?{bodyType:data.bodyType}:{}),...(data.color!==undefined?{color:data.color}:{}),...(data.ownershipCount!==undefined?{ownershipCount:data.ownershipCount}:{}),...(data.registrationState!==undefined?{registrationState:data.registrationState}:{}),...(data.insuranceValidTill!==undefined?{insuranceValidTill:data.insuranceValidTill}:{}),city:data.city??d.city,state:data.state,status:"DRAFT"});
 res.status(201).json({success:true,data:await shape(car),message:"Vehicle saved as a draft. Add photos and submit it for review."});
}));
dealerCarsRouter.patch("/:id",asyncHandler(async(req,res)=>{
 const id=parseId(req.params.id),p=updateCarSchema.safeParse(req.body);if(!p.success){res.status(400).json({success:false,error:{code:"VALIDATION_ERROR",message:"Check the vehicle details.",details:p.error.flatten().fieldErrors}});return;}
 const d=await requireDealerProfile(req.auth!.userId);const car=await Car.findOne({_id:id,dealerId:d.id});if(!car)throw new HttpError(404,"Vehicle not found in your inventory.","CAR_NOT_FOUND");if(["SOLD","ARCHIVED"].includes(car.status))throw new HttpError(409,"Sold or archived vehicles cannot be edited.","CAR_NOT_EDITABLE");
 const data:any={...p.data};for(const key of Object.keys(data))if(data[key]===null)data[key]=undefined;
 if(car.status==="AVAILABLE"){data.status="PENDING_APPROVAL";data.publishedAt=null;}if(car.status==="REJECTED")data.status="DRAFT";
 Object.assign(car,data);await car.save();res.status(200).json({success:true,data:await shape(car),message:"Vehicle details updated."});
}));
dealerCarsRouter.patch("/:id/status",asyncHandler(async(req,res)=>{
 const id=parseId(req.params.id),p=statusSchema.safeParse(req.body);if(!p.success){res.status(400).json({success:false,error:{code:"INVALID_STATUS",message:"The requested status is not allowed."}});return;}
 const d=await requireDealerProfile(req.auth!.userId);const car=await Car.findOne({_id:id,dealerId:d.id});if(!car)throw new HttpError(404,"Vehicle not found in your inventory.","CAR_NOT_FOUND");
 const requested=p.data.status;const allowed=(requested==="PENDING_APPROVAL"&&["DRAFT","REJECTED"].includes(car.status))||(requested==="RESERVED"&&car.status==="AVAILABLE")||(requested==="SOLD"&&["AVAILABLE","RESERVED"].includes(car.status))||(requested==="DRAFT"&&["REJECTED","PENDING_APPROVAL"].includes(car.status))||(requested==="ARCHIVED"&&car.status!=="ARCHIVED");
 if(!allowed)throw new HttpError(409,"This vehicle cannot move to the requested status. Listings become available only after admin approval.","INVALID_STATUS_TRANSITION");
 car.status=requested;if(requested==="SOLD")car.soldAt=new Date();if(requested==="RESERVED")car.reservedAt=new Date();await car.save();res.status(200).json({success:true,data:await shape(car)});
}));
dealerCarsRouter.delete("/:id",asyncHandler(async(req,res)=>{
 const id=parseId(req.params.id),d=await requireDealerProfile(req.auth!.userId);const car=await Car.findOne({_id:id,dealerId:d.id});if(!car)throw new HttpError(404,"Vehicle not found in your inventory.","CAR_NOT_FOUND");if(car.status==="SOLD")throw new HttpError(409,"Sold vehicle history is preserved and cannot be archived from this action.","SOLD_CAR_HISTORY_PROTECTED");
 car.status="ARCHIVED";await car.save();res.status(200).json({success:true,data:await shape(car),message:"Vehicle archived. Enquiry history has been preserved."});
}));
