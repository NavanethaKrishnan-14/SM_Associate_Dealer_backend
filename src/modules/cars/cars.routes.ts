import { Router } from "express";
import { z } from "zod";
import { z } from "zod";
import { Car, CarImage, Dealer, Brand, CarModel } from "../../lib/mongo.js";
import { listCarsQuerySchema } from "./cars.schemas.js";
export const carsRouter=Router();
const safeRegex=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
async function shapeCar(car:any, full=false){
 const [brand,model,dealer,images]=await Promise.all([
  Brand.findById(car.brandId).select(full?"name slug":"name slug").lean(),
  CarModel.findById(car.modelId).select("name slug").lean(),
  Dealer.findById(car.dealerId).select("businessName city verificationStatus").lean(),
  CarImage.find({carId:car.id}).select("imageUrl isCover sortOrder").sort({isCover:-1,sortOrder:1}).lean()
 ]);
 return {id:car.id,title:car.title,variant:car.variant??null,...(full?{description:car.description??null,registrationYear:car.registrationYear??null,color:car.color??null,bodyType:car.bodyType??null,ownershipCount:car.ownershipCount??null,registrationState:car.registrationState??null,insuranceValidTill:car.insuranceValidTill??null}:{}),priceInr:String(car.priceInr),status:car.status,manufacturingYear:car.manufacturingYear,mileageKm:car.mileageKm,fuelType:car.fuelType,transmission:car.transmission,city:car.city,state:car.state,publishedAt:car.publishedAt,brand:brand?{id:String(brand._id),name:brand.name,slug:brand.slug}:null,model:model?{id:String(model._id),name:model.name,slug:model.slug}:null,images:images.map((i:any)=>({id:String(i._id),imageUrl:i.imageUrl,isCover:i.isCover,sortOrder:i.sortOrder})),dealer:dealer?{id:String(dealer._id),businessName:dealer.businessName,city:dealer.city}:null,...(full?{description:car.description??null,createdAt:car.createdAt,updatedAt:car.updatedAt}: {})};
}
carsRouter.get("/images/:imageId/content", async (req, res, next) => {
 try {
  const parsed = z.string().uuid().safeParse(req.params.imageId);
  if (!parsed.success) { res.status(400).json({ success:false, error:{ code:"INVALID_IMAGE_ID", message:"The image ID is invalid." } }); return; }
  const image = await CarImage.findById(parsed.data).select("data contentType sizeBytes");
  if (!image || !image.data || !image.contentType) { res.status(404).json({ success:false, error:{ code:"IMAGE_NOT_FOUND", message:"Image not found." } }); return; }
  res.setHeader("Content-Type", image.contentType);
  res.setHeader("Content-Length", String(image.sizeBytes ?? image.data.length));
  res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).end(image.data);
 } catch (error) { next(error); }
});

carsRouter.get("/",async(req,res,next)=>{
 const parsed=listCarsQuerySchema.safeParse(req.query);
 if(!parsed.success){res.status(400).json({success:false,error:{code:"INVALID_QUERY",message:"One or more search filters are invalid.",details:parsed.error.flatten().fieldErrors}});return;}
 try{
  const f=parsed.data;
  const query:any={status:"AVAILABLE",publishedAt:{$ne:null}};
  const approved=await Dealer.find({verificationStatus:"APPROVED"}).select("_id").lean();
  query.dealerId={$in:approved.map((d:any)=>String(d._id))};
  if(f.city)query.city={$regex:safeRegex(f.city),$options:"i"};
  if(f.fuelType)query.fuelType=f.fuelType;
  if(f.transmission)query.transmission=f.transmission;
  if(f.minPrice!==undefined||f.maxPrice!==undefined)query.priceInr={...(f.minPrice!==undefined?{$gte:f.minPrice}:{}),...(f.maxPrice!==undefined?{$lte:f.maxPrice}:{})};
  if(f.minYear!==undefined||f.maxYear!==undefined)query.manufacturingYear={...(f.minYear!==undefined?{$gte:f.minYear}:{}),...(f.maxYear!==undefined?{$lte:f.maxYear}:{})};
  if(f.brand){const b=await Brand.findOne({slug:f.brand}).select("_id").lean();query.brandId=b?String(b._id):"__not_found__";}
  if(f.model){const m=await CarModel.findOne({slug:f.model}).select("_id").lean();query.modelId=m?String(m._id):"__not_found__";}
  if(f.q){const regex={$regex:safeRegex(f.q),$options:"i"};const [brands,modelsFound]=await Promise.all([Brand.find({name:regex}).select("_id").lean(),CarModel.find({name:regex}).select("_id").lean()]);query.$or=[{title:regex},{description:regex},{variant:regex},{brandId:{$in:brands.map((x:any)=>String(x._id))}},{modelId:{$in:modelsFound.map((x:any)=>String(x._id))}}];}
  const sort:any=f.sort==="price_asc"?{priceInr:1,createdAt:-1}:f.sort==="price_desc"?{priceInr:-1,createdAt:-1}:f.sort==="year_desc"?{manufacturingYear:-1,createdAt:-1}:f.sort==="mileage_asc"?{mileageKm:1,createdAt:-1}:{publishedAt:-1,createdAt:-1};
  const [cars,total]=await Promise.all([Car.find(query).sort(sort).skip((f.page-1)*f.limit).limit(f.limit).lean(),Car.countDocuments(query)]);
  const data=await Promise.all(cars.map((car:any)=>shapeCar({...car,id:String(car._id)})));
  res.status(200).json({success:true,data,pagination:{page:f.page,limit:f.limit,total,totalPages:Math.ceil(total/f.limit)}});
 }catch(error){next(error);}
});
carsRouter.get("/:id",async(req,res,next)=>{
 try{
  const car=await Car.findOne({_id:req.params.id,status:"AVAILABLE",publishedAt:{$ne:null}}).lean();
  if(!car){res.status(404).json({success:false,error:{code:"CAR_NOT_FOUND",message:"Vehicle not found or no longer available."}});return;}
  const dealer=await Dealer.findById(car.dealerId).lean();
  if(!dealer||dealer.verificationStatus!=="APPROVED"){res.status(404).json({success:false,error:{code:"CAR_NOT_FOUND",message:"Vehicle not found or no longer available."}});return;}
  res.status(200).json({success:true,data:await shapeCar({...car,id:String(car._id)},true)});
 }catch(error){next(error);}
});
