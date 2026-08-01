import { chromium } from "playwright";
import { mintRefreshToken, bootScript } from "./audit-session.mjs";
const PAGES = process.argv.slice(2);
const b = await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--no-sandbox"]});
const ctx = await b.newContext({viewport:{width:420,height:1000}});
const rt = await mintRefreshToken();
await ctx.addInitScript(bootScript("en", rt));
const p = await ctx.newPage();
for (const path of PAGES) {
  await p.goto(`http://localhost:3111/en${path === "/" ? "" : path}`, {waitUntil:"networkidle"}).catch(()=>{});
  await p.waitForTimeout(1500);
  await p.screenshot({path:`/tmp/shots/en${path.replace(/[^a-z]/gi,"_")||"home"}.png`, fullPage:true});
}
await b.close(); console.log("done");
