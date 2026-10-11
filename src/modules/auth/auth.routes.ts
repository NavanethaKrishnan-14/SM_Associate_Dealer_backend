import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../../config/env.js";
import { authenticate } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { User, Dealer, RefreshToken } from "../../lib/mongo.js";

export const authRouter = Router();
const loginLimiter = rateLimit({ windowMs: 15*60*1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { success:false,error:{code:"AUTH_RATE_LIMITED",message:"Too many authentication attempts. Please wait before trying again."} } });
const registrationLimiter = rateLimit({ windowMs: 60*60*1000, limit: 8, standardHeaders: "draft-8", legacyHeaders: false, message: { success:false,error:{code:"REGISTRATION_RATE_LIMITED",message:"Too many registration attempts. Try again later."} } });
const passwordSchema=z.string().min(8).max(72);
const phoneSchema=z.string().trim().regex(/^\+?[0-9]{10,15}$/,"Enter a valid phone number.");
const emailSchema=z.string().trim().email().max(254).optional();
const customerRegistrationSchema=z.object({name:z.string().trim().min(2).max(100),phone:phoneSchema,email:emailSchema,password:passwordSchema});
const dealerRegistrationSchema=customerRegistrationSchema.extend({businessName:z.string().trim().min(2).max(120),city:z.string().trim().min(2).max(100)});
const loginSchema=z.object({identifier:z.string().trim().min(3).max(254),password:passwordSchema});
const refreshSchema=z.object({refreshToken:z.string().min(20).max(256)});
const hashToken=(token:string)=>createHash("sha256").update(token).digest("hex");
function duplicate(error:unknown){return !!error && typeof error==="object" && "code" in error && (error as {code?:unknown}).code===11000;}
async function issueSession(user:{id:string;role:string}) {
 const refreshToken=randomBytes(48).toString("base64url");
 await RefreshToken.create({userId:user.id,tokenHash:hashToken(refreshToken),expiresAt:new Date(Date.now()+env.REFRESH_TOKEN_DAYS*86400000)});
 const accessToken=jwt.sign({role:user.role},env.JWT_ACCESS_SECRET,{subject:user.id,expiresIn:env.JWT_ACCESS_TTL_SECONDS});
 return {accessToken,refreshToken,tokenType:"Bearer",expiresIn:env.JWT_ACCESS_TTL_SECONDS};
}
function validation(res:any,message:string,details:unknown){res.status(400).json({success:false,error:{code:"VALIDATION_ERROR",message,details}});}
authRouter.post("/register/customer",registrationLimiter,asyncHandler(async(req,res)=>{
 const parsed=customerRegistrationSchema.safeParse(req.body); if(!parsed.success){validation(res,"Check the registration details.",parsed.error.flatten().fieldErrors);return;}
 const d=parsed.data;
 try{
  const user=await User.create({name:d.name,phone:d.phone,...(d.email?{email:d.email.toLowerCase()}:{}),passwordHash:await bcrypt.hash(d.password,12),role:"CUSTOMER"});
  const session=await issueSession({id:user.id,role:user.role});
  res.status(201).json({success:true,data:{user:{id:user.id,name:user.name,email:user.email??null,phone:user.phone,role:user.role,status:user.status},...session}});
 }catch(error){if(duplicate(error))throw new HttpError(409,"An account with this phone number or email already exists.","ACCOUNT_ALREADY_EXISTS");throw error;}
}));
authRouter.post("/register/dealer",registrationLimiter,asyncHandler(async(req,res)=>{
 const parsed=dealerRegistrationSchema.safeParse(req.body);if(!parsed.success){validation(res,"Check the dealer registration details.",parsed.error.flatten().fieldErrors);return;}
 const d=parsed.data;
 try{
  const user=await User.create({name:d.name,phone:d.phone,...(d.email?{email:d.email.toLowerCase()}:{}),passwordHash:await bcrypt.hash(d.password,12),role:"DEALER"});
  const dealer=await Dealer.create({userId:user.id,businessName:d.businessName,city:d.city,state:"Tamil Nadu",verificationStatus:"PENDING"});
  const session=await issueSession({id:user.id,role:user.role});
  res.status(201).json({success:true,data:{user:{id:user.id,name:user.name,email:user.email??null,phone:user.phone,role:user.role,status:user.status,dealerProfile:{id:dealer.id,businessName:dealer.businessName,city:dealer.city,verificationStatus:dealer.verificationStatus}},...session}});
 }catch(error){if(duplicate(error))throw new HttpError(409,"An account with this phone number or email already exists.","ACCOUNT_ALREADY_EXISTS");throw error;}
}));
authRouter.post("/login",loginLimiter,asyncHandler(async(req,res)=>{
 const parsed=loginSchema.safeParse(req.body);if(!parsed.success){validation(res,"Enter your phone/email and password.",parsed.error.flatten().fieldErrors);return;}
 const identifier=parsed.data.identifier;
 const user=await User.findOne({$or:[{phone:identifier},{email:identifier.toLowerCase()}]});
 if(!user||!(await bcrypt.compare(parsed.data.password,user.passwordHash)))throw new HttpError(401,"The phone/email or password is incorrect.","INVALID_CREDENTIALS");
 if(user.status!=="ACTIVE")throw new HttpError(403,"This account is not active. Contact support for assistance.","ACCOUNT_INACTIVE");
 const dealer= user.role==="DEALER" ? await Dealer.findOne({userId:user.id}) : null;
 const session=await issueSession({id:user.id,role:user.role});
 const safeUser={id:user.id,name:user.name,email:user.email??null,phone:user.phone,role:user.role,status:user.status,...(dealer?{dealerProfile:{id:dealer.id,businessName:dealer.businessName,city:dealer.city,verificationStatus:dealer.verificationStatus}}:{})};
 res.status(200).json({success:true,data:{user:safeUser,...session}});
}));
authRouter.post("/refresh",loginLimiter,asyncHandler(async(req,res)=>{
 const parsed=refreshSchema.safeParse(req.body);if(!parsed.success)throw new HttpError(400,"A valid refresh token is required.","INVALID_REFRESH_TOKEN");
 const stored=await RefreshToken.findOne({tokenHash:hashToken(parsed.data.refreshToken),revokedAt:null,expiresAt:{$gt:new Date()}}); 
 if(!stored)throw new HttpError(401,"The refresh token is invalid or expired. Please sign in again.","INVALID_REFRESH_TOKEN");
 const user=await User.findById(stored.userId);
 if(!user||user.status!=="ACTIVE")throw new HttpError(401,"The refresh token is invalid or expired. Please sign in again.","INVALID_REFRESH_TOKEN");
 stored.revokedAt=new Date();await stored.save();
 const nextRefreshToken=randomBytes(48).toString("base64url");
 await RefreshToken.create({userId:user.id,tokenHash:hashToken(nextRefreshToken),expiresAt:new Date(Date.now()+env.REFRESH_TOKEN_DAYS*86400000)});
 const accessToken=jwt.sign({role:user.role},env.JWT_ACCESS_SECRET,{subject:user.id,expiresIn:env.JWT_ACCESS_TTL_SECONDS});
 res.status(200).json({success:true,data:{accessToken,refreshToken:nextRefreshToken,tokenType:"Bearer",expiresIn:env.JWT_ACCESS_TTL_SECONDS}});
}));
authRouter.post("/logout",asyncHandler(async(req,res)=>{
 const parsed=refreshSchema.safeParse(req.body);if(parsed.success)await RefreshToken.updateOne({tokenHash:hashToken(parsed.data.refreshToken),revokedAt:null},{$set:{revokedAt:new Date()}});
 res.status(200).json({success:true,data:{message:"Signed out."}});
}));
authRouter.get("/me",authenticate,asyncHandler(async(req,res)=>{
 const user=await User.findById(req.auth!.userId).select("-passwordHash");
 if(!user||user.status!=="ACTIVE")throw new HttpError(401,"This account is no longer active.","ACCOUNT_INACTIVE");
 const dealer=user.role==="DEALER"?await Dealer.findOne({userId:user.id}):null;
 res.status(200).json({success:true,data:{id:user.id,name:user.name,email:user.email??null,phone:user.phone,role:user.role,status:user.status,createdAt:user.createdAt,...(dealer?{dealerProfile:{id:dealer.id,businessName:dealer.businessName,city:dealer.city,verificationStatus:dealer.verificationStatus}}:{})}});
}));
