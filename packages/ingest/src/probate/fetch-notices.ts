/**
 * Headless fetch for free Texas probate notices (texaspublicnotices.com).
 *
 * The site's search is ASP.NET WebForms that renders results via an async
 * postback, so a raw HTTP client can't drive it — a real browser can. This
 * runs the Travis + "Letters Testamentary" search, paginates, and writes the
 * results HTML that `probate-ingest.ts --notices-file` parses. Zero cost.
 *
 * The site's robots.txt allows `/` and there's no CAPTCHA; still, respect the
 * Terms of Use and keep it polite (this runs once, slowly, on a schedule).
 *
 * Usage:
 *   pnpm --filter @fulcrum/ingest fetch:notices [out.html] [--keyword "..."] \
 *                                               [--months 3] [--max-pages 10]
 * then:
 *   pnpm --filter @fulcrum/ingest ingest:probate --notices-file out.html
 */

import { writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { parseNotices } from "./sources/public-notice.js";

const SEARCH_URL = "https://www.texaspublicnotices.com/Search.aspx";
// Keyword filter (All Words): probate notices contain all of these. Using the
// keyword to scope to Travis avoids driving the 250-county checkbox accordion.
const DEFAULT_KEYWORD = "Letters Testamentary Travis County Deceased";
const PREFIX = "#ctl00_ContentPlaceHolder1_as1_";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// WebForms postbacks can navigate mid-call, so page.content() may throw
// "page is navigating" — settle the load state and retry.
async function safeContent(page: Page): Promise<string> {
  for (let i = 0; i < 5; i++) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      return await page.content();
    } catch {
      await page.waitForTimeout(1000);
    }
  }
  return await page.evaluate(() => document.documentElement.outerHTML).catch(() => "");
}

async function clickNext(page: Page): Promise<boolean> {
  // WebForms result pagers are usually "Next" / ">" links or numbered pages.
  const next = page
    .locator('a:has-text("Next"), a[title="Next"], a:has-text(">")')
    .filter({ hasNot: page.locator('[disabled]') })
    .first();
  if ((await next.count()) === 0) return false;
  try {
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 20000 }),
      next.click({ timeout: 5000 }),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const out = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "notices.html";
  const keyword = arg("--keyword", DEFAULT_KEYWORD);
  const months = arg("--months", "3");
  const maxPages = Number(arg("--max-pages", "10"));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });

  console.log(`searching texaspublicnotices.com for "${keyword}" (last ${months} months)…`);
  await page.goto(SEARCH_URL, { waitUntil: "networkidle", timeout: 45000 });

  await page.fill(`${PREFIX}txtSearch`, keyword);
  // recency filter, if the field is present
  const monthsField = page.locator(`${PREFIX}txtLastNumMonths`);
  if (await monthsField.count()) await monthsField.fill(months).catch(() => {});

  // submit (btnGo1, else btnGo, else Enter) and wait for the async result render
  const go = page.locator(`${PREFIX}btnGo1, ${PREFIX}btnGo`).first();
  if (await go.count()) await go.click();
  else await page.press(`${PREFIX}txtSearch`, "Enter");
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  // wait for results prose to actually appear (async postback), then settle
  await page.waitForFunction(() => /Estate of|No public notices|no notices/i.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const pages: string[] = [];
  for (let i = 0; i < maxPages; i++) {
    pages.push(await safeContent(page));
    const found = parseNotices(pages.join("\n")).length;
    process.stdout.write(`  page ${i + 1}: ${found} notices so far\r`);
    if (!(await clickNext(page))) break;
    await page.waitForTimeout(1000); // polite pacing
  }

  await browser.close();

  const html = pages.join("\n<!-- page -->\n");
  writeFileSync(out, html);
  const filings = parseNotices(html);
  console.log(`\nwrote ${out} (${html.length} bytes) · parsed ${filings.length} probate notices`);
  if (filings.length) {
    console.log("sample:");
    for (const f of filings.slice(0, 5)) {
      console.log(`  ${f.decedentName} · ${f.causeNumber || "no cause#"} · ${f.filedAt.toISOString().slice(0, 10)}`);
    }
  } else {
    console.log(
      "no notices parsed — the results DOM may differ; open the saved HTML to check, or widen --months.",
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
