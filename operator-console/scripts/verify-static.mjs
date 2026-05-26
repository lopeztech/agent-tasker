import { access, readFile } from "node:fs/promises";

const requiredFiles = ["index.html", "styles.css", "main.js"];

for (const file of requiredFiles) {
  await access(new URL(`../${file}`, import.meta.url));
}

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
for (const file of ["styles.css", "main.js"]) {
  if (!html.includes(file)) {
    throw new Error(`index.html does not reference ${file}`);
  }
}

console.log("operator-console static files verified");
