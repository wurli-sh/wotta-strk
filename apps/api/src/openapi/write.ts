import { mkdir, writeFile } from "node:fs/promises";
import { openApiDocument } from "./document.ts";
await mkdir("public", { recursive: true }); await writeFile("public/openapi.json", `${JSON.stringify(openApiDocument(), null, 2)}\n`);
