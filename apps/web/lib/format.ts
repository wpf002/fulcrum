// Shared display formatting. County records arrive in ALL CAPS ("1315 SOUTHPORT
// DR C", "DREAM11 TEJAS INVESTMENTS LLC"); title-case them for the UI while
// keeping the tokens that should stay uppercase.

// Entity/legal forms, unit letters, and directionals that must not become "Llc".
const UPPER = new Set([
  "LLC", "L.L.C.", "LP", "LLP", "LTD", "INC", "CORP", "CO", "PC", "PLLC",
  "TR", "TRS", "USA", "US", "TX", "II", "III", "IV", "V", "JR", "SR",
  "N", "S", "E", "W", "NE", "NW", "SE", "SW",
]);
// Street-type abbreviations that read better expanded-cased, not upper.
const ORDINAL = /^\d+(ST|ND|RD|TH)$/;

export function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .trim()
    .split(/\s+/)
    .map((word) => {
      const bare = word.replace(/[^\w.]/g, "");
      if (UPPER.has(bare.toUpperCase())) return bare.toUpperCase();
      if (ORDINAL.test(bare.toUpperCase())) return bare.toLowerCase(); // 1st, 2nd
      // single letters stay upper (unit designators: "SOUTHPORT DR C")
      if (bare.length === 1 && /[A-Za-z]/.test(bare)) return word.toUpperCase();
      return word
        .toLowerCase()
        .replace(/(^|[\s'\-/.])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
    })
    .join(" ");
}
