import { buildApiApp } from "../server/api-app";

const appPromise = Promise.resolve(buildApiApp());

export default async function handler(req: any, res: any) {
  const app = await appPromise;
  return app(req, res);
}
