const fs = require("fs");
const results = JSON.parse(fs.readFileSync(".listed-import-results-mainBoard.json", "utf8"));

const succeeded = new Set();
results.forEach(r => {
  if (r.success) succeeded.add(r.ticker);
});

const neverSucceeded = new Map();
results.forEach(r => {
  if (!succeeded.has(r.ticker)) {
    neverSucceeded.set(r.ticker, r.company);
  }
});

const sorted = [...neverSucceeded.entries()].sort((a,b) => a[0] - b[0]);
console.log("Tickers that NEVER succeeded (" + sorted.length + " unique):");
sorted.forEach(([ticker, company]) => {
  console.log(ticker + " | " + company);
});
