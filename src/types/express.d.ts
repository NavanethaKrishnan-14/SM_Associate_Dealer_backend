import type { UserRole } from "../middleware/authenticate.js";
declare global {
 namespace Express {
  interface Request { auth?: { userId: string; role: UserRole }; }
 }
}
export {};
