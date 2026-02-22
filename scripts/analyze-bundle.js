const fs = require("fs");

const pageLoad = fs.readFileSync("./junk/pageLoad.txt", "utf-8"); // paste in pageLoad.txt what the browser returns (format is : "chunkName | size\n")
const bundleReport = JSON.parse(fs.readFileSync("./junk/full-bundle-report.json", "utf-8"));

const loadedChunks = pageLoad
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => line.split("|")[0].trim());

const result = {};

for (const chunk of loadedChunks) {
  // AI : Vite/Rolldown hashes are always exactly 8 chars ([a-zA-Z0-9_-]), strip only that suffix
  const prefix = chunk.replace(/-[a-zA-Z0-9_-]{8}\.js$/, "");

  const key = Object.keys(bundleReport).find((k) => {
    const kName = k.split("/").pop();
    const kPrefix = kName.replace(/-[a-zA-Z0-9_-]{8}\.js$/, "");
    return kPrefix.toLowerCase() === prefix.toLowerCase();
  });

  if (key) {
    // AI : Replace the hash in the key with "hash"
    const newKey = chunk.replace(/-[a-zA-Z0-9_-]{8}\.js$/, "-hash.js");
    result[newKey] = bundleReport[key];
  } else {
    const newKey = chunk.replace(/-[a-zA-Z0-9_-]{8}\.js$/, "-hash.js");
    result[newKey] = ["NOT FOUND IN BUNDLE REPORT"];
  }
}

fs.writeFileSync("./junk/page-load-report.json", JSON.stringify(result, null, 2));
console.log("Created page-load-report.json with " + Object.keys(result).length + " chunks.");
