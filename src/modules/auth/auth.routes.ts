import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
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
const registrationFields=z.object({name:z.string().trim().min(2).max(100),phone:phoneSchema,email:emailSchema,password:passwordSchema,confirmPassword:z.string().min(1).optional()}).refine((data)=>data.confirmPassword===undefined || data.password===data.confirmPassword,{message:"Passwords do not match.",path:["confirmPassword"]});
const customerRegistrationSchema=registrationFields;
const dealerRegistrationSchema=z.object({name:z.string().trim().min(2).max(100),phone:phoneSchema,email:emailSchema,password:passwordSchema,confirmPassword:z.string().min(1).optional(),businessName:z.string().trim().min(2).max(120),city:z.string().trim().min(2).max(100)}).refine((data)=>data.confirmPassword===undefined || data.password===data.confirmPassword,{message:"Passwords do not match.",path:["confirmPassword"]});
const loginSchema=z.object({identifier:z.string().trim().min(3).max(254),password:passwordSchema,role:z.enum(["CUSTOMER","DEALER","ADMIN"]).optional()});
const refreshSchema=z.object({refreshToken:z.string().min(20).max(256)});
const hashToken=(token:string)=>createHash("sha256").update(token).digest("hex");
function duplicate(error:unknown){return !!error && typeof error==="object" && "code" in error && (error as {code?:unknown}).code===11000;}
async function issueSession(user:{id:string;role:string}) {
 const refreshToken=randomBytes(48).toString("base64url");
 await RefreshToken.create({userId:user.id,tokenHash:hashToken(refreshToken),expiresAt:new Date(Date.now()+env.REFRESH_TOKEN_DAYS*86400000)});
 const accessToken=jwt.sign({role:user.role},env.JWT_ACCESS_SECRET,{subject:user.id,expiresIn:env.JWT_ACCESS_TTL_SECONDS,algorithm:"HS256"});
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

const socialSchema = z.object({
  role: z.enum(["CUSTOMER", "DEALER"]),
  businessName: z.string().trim().min(2).max(120).optional(),
  city: z.string().trim().min(2).max(100).optional(),
});
const googleTokenSchema = socialSchema.extend({ idToken: z.string().min(20).max(8192) });
const facebookTokenSchema = socialSchema.extend({ accessToken: z.string().min(20).max(8192) });

async function establishSocialSession(input: {
  provider: "google" | "facebook";
  providerId: string;
  email?: string;
  name: string;
  role: "CUSTOMER" | "DEALER";
  businessName?: string;
  city?: string;
}) {
  const providerField = input.provider === "google" ? "googleId" : "facebookId";
  let user = await User.findOne({ [providerField]: input.providerId });
  if (user) {
    if (user.status !== "ACTIVE") throw new HttpError(403, "This account is not active. Contact support for assistance.", "ACCOUNT_INACTIVE");
    if (user.role !== input.role) throw new HttpError(403, "This account is registered as " + user.role.toLowerCase() + ". Select the matching role to sign in.", "ROLE_MISMATCH");
  } else {
    if (input.email) {
      const existing = await User.findOne({ email: input.email.toLowerCase() });
      if (existing) throw new HttpError(409, "An account with this email already exists. Sign in with your existing method before linking social login.", "SOCIAL_ACCOUNT_LINK_REQUIRED");
    }
    if (input.role === "DEALER" && (!input.businessName || !input.city)) {
      throw new HttpError(400, "Dealer social registration requires businessName and city.", "DEALER_PROFILE_REQUIRED");
    }
    try {
      user = await User.create({
        name: input.name.trim() || (input.provider === "google" ? "Google user" : "Facebook user"),
        ...(input.email ? { email: input.email.toLowerCase() } : {}),
        [providerField]: input.providerId,
        role: input.role,
        status: "ACTIVE",
      });
      if (input.role === "DEALER") {
        await Dealer.create({ userId: user.id, businessName: input.businessName, city: input.city, state: "Tamil Nadu", verificationStatus: "PENDING" });
      }
    } catch (error) {
      if (duplicate(error)) throw new HttpError(409, "This social account is already registered. Please sign in again.", "SOCIAL_ACCOUNT_EXISTS");
      throw error;
    }
  }
  const dealer = user.role === "DEALER" ? await Dealer.findOne({ userId: user.id }) : null;
  const session = await issueSession({ id: user.id, role: user.role });
  return {
    user: {
      id: user.id, name: user.name, email: user.email ?? null, phone: user.phone ?? "",
      role: user.role, status: user.status,
      ...(dealer ? { dealerProfile: { id: dealer.id, businessName: dealer.businessName, city: dealer.city, verificationStatus: dealer.verificationStatus } } : {}),
    },
    ...session,
  };
}

authRouter.post("/google", loginLimiter, asyncHandler(async (req, res) => {
  const parsed = googleTokenSchema.safeParse(req.body);
  if (!parsed.success) { validation(res, "A valid Google ID token and role are required.", parsed.error.flatten().fieldErrors); return; }
  const allowedClientIds = env.GOOGLE_CLIENT_IDS.split(",").map((id) => id.trim()).filter(Boolean);
  if (!allowedClientIds.length) throw new HttpError(503, "Google sign-in is not configured on the server.", "GOOGLE_SSO_NOT_CONFIGURED");
  const verifyUrl = new URL("https://oauth2.googleapis.com/tokeninfo");
  verifyUrl.searchParams.set("id_token", parsed.data.idToken);
  const response = await fetch(verifyUrl, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new HttpError(401, "Google could not verify this sign-in token.", "INVALID_GOOGLE_TOKEN");
  const payload = await response.json() as { sub?: string; aud?: string; iss?: string; exp?: string; email?: string; email_verified?: string | boolean; name?: string };
  if (!payload.sub || !payload.aud || !allowedClientIds.includes(payload.aud) ||
      !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss ?? "") ||
      Number(payload.exp ?? 0) * 1000 <= Date.now() ||
      !payload.email || ![true, "true"].includes(payload.email_verified ?? false)) {
    throw new HttpError(401, "Google token is invalid, expired, unverified, or issued for another app.", "INVALID_GOOGLE_TOKEN");
  }
  const data = await establishSocialSession({
    provider: "google", providerId: payload.sub, email: payload.email, name: payload.name ?? "",
    role: parsed.data.role, businessName: parsed.data.businessName, city: parsed.data.city,
  });
  res.status(200).json({ success: true, data });
}));

authRouter.post("/facebook", loginLimiter, asyncHandler(async (req, res) => {
  const parsed = facebookTokenSchema.safeParse(req.body);
  if (!parsed.success) { validation(res, "A valid Facebook access token and role are required.", parsed.error.flatten().fieldErrors); return; }
  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) throw new HttpError(503, "Facebook sign-in is not configured on the server.", "FACEBOOK_SSO_NOT_CONFIGURED");
  const appAccessToken = env.FACEBOOK_APP_ID + "|" + env.FACEBOOK_APP_SECRET;
  const debugUrl = new URL("https://graph.facebook.com/debug_token");
  debugUrl.searchParams.set("input_token", parsed.data.accessToken);
  debugUrl.searchParams.set("access_token", appAccessToken);
  const debugResponse = await fetch(debugUrl, { signal: AbortSignal.timeout(8000) });
  if (!debugResponse.ok) throw new HttpError(401, "Facebook could not verify this sign-in token.", "INVALID_FACEBOOK_TOKEN");
  const debugBody = await debugResponse.json() as { data?: { app_id?: string; is_valid?: boolean; user_id?: string; expires_at?: number } };
  const tokenInfo = debugBody.data;
  if (!tokenInfo?.is_valid || tokenInfo.app_id !== env.FACEBOOK_APP_ID || !tokenInfo.user_id ||
      (tokenInfo.expires_at && tokenInfo.expires_at * 1000 <= Date.now())) {
    throw new HttpError(401, "Facebook token is invalid, expired, or issued for another app.", "INVALID_FACEBOOK_TOKEN");
  }
  const profileUrl = new URL("https://graph.facebook.com/me");
  profileUrl.searchParams.set("fields", "id,name,email");
  profileUrl.searchParams.set("access_token", parsed.data.accessToken);
  const profileResponse = await fetch(profileUrl, { signal: AbortSignal.timeout(8000) });
  if (!profileResponse.ok) throw new HttpError(401, "Unable to read the Facebook profile.", "FACEBOOK_PROFILE_UNAVAILABLE");
  const profile = await profileResponse.json() as { id?: string; name?: string; email?: string };
  if (!profile.id || profile.id !== tokenInfo.user_id) throw new HttpError(401, "Facebook profile does not match the verified token.", "INVALID_FACEBOOK_PROFILE");
  const data = await establishSocialSession({
    provider: "facebook", providerId: profile.id, email: profile.email, name: profile.name ?? "",
    role: parsed.data.role, businessName: parsed.data.businessName, city: parsed.data.city,
  });
  res.status(200).json({ success: true, data });
}));

authRouter.post("/login",loginLimiter,asyncHandler(async(req,res)=>{
 const parsed=loginSchema.safeParse(req.body);if(!parsed.success){validation(res,"Enter your phone/email and password.",parsed.error.flatten().fieldErrors);return;}
 const identifier=parsed.data.identifier;
 const user=await User.findOne({$or:[{phone:identifier},{email:identifier.toLowerCase()}]});
 if(!user||!user.passwordHash||!(await bcrypt.compare(parsed.data.password,user.passwordHash)))throw new HttpError(401,"The phone/email or password is incorrect.","INVALID_CREDENTIALS");
 if(user.status!=="ACTIVE")throw new HttpError(403,"This account is not active. Contact support for assistance.","ACCOUNT_INACTIVE");
 if(parsed.data.role && !(parsed.data.role==="ADMIN" && user.role==="ADMIN") && user.role!==parsed.data.role)throw new HttpError(403,`This account is registered as ${user.role.toLowerCase()}. Select the matching role to sign in.`,"ROLE_MISMATCH");
 const dealer= user.role==="DEALER" ? await Dealer.findOne({userId:user.id}) : null;
 const session=await issueSession({id:user.id,role:user.role});
 const safeUser={id:user.id,name:user.name,email:user.email??null,phone:user.phone,role:user.role,status:user.status,...(dealer?{dealerProfile:{id:dealer.id,businessName:dealer.businessName,city:dealer.city,verificationStatus:dealer.verificationStatus}}:{})};
 res.status(200).json({success:true,data:{user:safeUser,...session}});
}));
authRouter.post("/refresh",loginLimiter,asyncHandler(async(req,res)=>{
 const parsed=refreshSchema.safeParse(req.body);if(!parsed.success)throw new HttpError(400,"A valid refresh token is required.","INVALID_REFRESH_TOKEN");
 const stored=await RefreshToken.findOneAndUpdate(
  {tokenHash:hashToken(parsed.data.refreshToken),revokedAt:null,expiresAt:{$gt:new Date()}},
  {$set:{revokedAt:new Date()}},
  {new:true},
 );
 if(!stored)throw new HttpError(401,"The refresh token is invalid or expired. Please sign in again.","INVALID_REFRESH_TOKEN");
 const user=await User.findById(stored.userId);
 if(!user||user.status!=="ACTIVE")throw new HttpError(401,"The refresh token is invalid or expired. Please sign in again.","INVALID_REFRESH_TOKEN");
 const nextRefreshToken=randomBytes(48).toString("base64url");
 await RefreshToken.create({userId:user.id,tokenHash:hashToken(nextRefreshToken),expiresAt:new Date(Date.now()+env.REFRESH_TOKEN_DAYS*86400000)});
 const accessToken=jwt.sign({role:user.role},env.JWT_ACCESS_SECRET,{subject:user.id,expiresIn:env.JWT_ACCESS_TTL_SECONDS,algorithm:"HS256"});
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
