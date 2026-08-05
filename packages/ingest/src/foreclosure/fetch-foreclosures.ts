/**
 * Headless fetch for free Texas foreclosure notices (texaspublicnotices.com).
 *
 * Searches "Substitute Trustee" scoped to Travis County (the county checkbox,
 * set via the DOM since the accordion is collapsed) and captures notice text,
 * clicking through to each result's detail page where the property ADDRESS
 * lives. Saves the combined text for foreclosure-ingest.ts --file.
 *
 * Caveat: the results list truncates each notice and the detail control is a
 * dynamic WebForms postback that is brittle to automate; best-effort here. The
 * reliable input is a saved detail-pages file (open each 'view' and save) or a
 * licensed foreclosure feed. Respect the site's Terms; keep it polite.
 *
 * Usage: pnpm --filter @fulcrum/ingest fetch:foreclosures [out.html] [--months 3] [--max-pages 5]
 */

import { writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

const URL = "https://www.texaspublicnotices.com/Search.aspx";
const P = "#ctl00_ContentPlaceHolder1_as1_";
const TRAVIS_CHECKBOX = "ctl00_ContentPlaceHolder1_as1_lstCounty_221";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function settle(page: Page): Promise<string> {
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  return page.evaluate(() => document.body.innerText).catch(() => "");
}

async function main() {
  const out = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "foreclosures.html";
  const months = arg("--months", "3");
  const maxPages = Number(arg("--max-pages", "5"));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: UA });
  console.log(`searching texaspublicnotices.com for Travis 'Substitute Trustee' (last ${months} months)…`);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 45000 });

  await page.fill(`${P}txtSearch`, "Substitute Trustee");
  await page.evaluate((id) => {
    const cb = document.getElementById(id) as HTMLInputElement | null;
    if (cb) {
      cb.checked = true;
      cb.dispatchEvent(new Event("click", { bubbles: true }));
    }
  }, TRAVIS_CHECKBOX);
  await page.locator(`${P}txtLastNumMonths`).fill(months).catch(() => {});
  await page.locator(`${P}btnGo1, ${P}btnGo`).first().click();
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Capture the results text across pages. Each notice's full text (with the
  // address) is on a detail view — best-effort: try opening each result's
  // detail, else keep the preview. Either way foreclosure-ingest parses what
  // has an address and quarantines the rest.
  const chunks: string[] = [];
  for (let i = 0; i < maxPages; i++) {
    chunks.push(await settle(page));
    const details = page.locator("a", { hasText: /^\s*view\s*$/i });
    const count = Math.min(await details.count(), 25);
    for (let d = 0; d < count; d++) {
      try {
        await details.nth(d).click({ timeout: 4000 });
        await page.waitForTimeout(700);
        chunks.push(await settle(page));
        await page.goBack({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(400);
      } catch {
        /* brittle detail nav — skip this one */
      }
    }
    const next = page.locator('a:has-text("Next"), a[title="Next"]').first();
    if ((await next.count()) === 0) break;
    await next.click().catch(() => {});
    await page.waitForTimeout(1200);
  }

  await browser.close();
  const html = chunks.join("\n<!-- page -->\n");
  writeFileSync(out, html);
  console.log(`wrote ${out} (${html.length} bytes). Ingest with:`);
  console.log(`  pnpm --filter @fulcrum/ingest foreclosure:ingest --file ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
