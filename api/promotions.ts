import { promotions } from "../server/saudi";
export default function handler(_req: any, res: any) { return res.status(200).json({ promotions }); }
