import { searchLocations } from "../server/saudi";
export default function handler(req: any, res: any) { return res.status(200).json({ locations: searchLocations(String(req.query?.q || ""), 10) }); }
