const fs = require("fs");

const pageLoad = fs.readFileSync("./junk/pageLoad.txt", "utf-8"); // paste in pageLoad.txt what the browser returns (format is : "chunkName | size\n")
const bundleReport = JSON.parse(fs.readFileSync("./junk/full-bundle-report.json", "utf-8"));

const loadedChunks = pageLoad
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => line.split("|")[0].trim());

const result = {};

for (const chunk of loadedChunks) {
  const prefix = chunk.split("-")[0].replace(".js", "");

  const key = Object.keys(bundleReport).find((k) => {
    const kName = k.split("/").pop();
    const kPrefix = kName.split("-")[0].replace(".js", "");
    return kPrefix.toLowerCase() === prefix.toLowerCase();
  });

  if (key) {
    // Replace the hash in the key with "hash"
    const newKey = chunk.replace(/-[a-zA-Z0-9_-]+\.js$/, "-hash.js");
    result[newKey] = bundleReport[key];
  } else {
    const newKey = chunk.replace(/-[a-zA-Z0-9_-]+\.js$/, "-hash.js");
    result[newKey] = ["NOT FOUND IN BUNDLE REPORT"];
  }
}

fs.writeFileSync("./junk/page-load-report.json", JSON.stringify(result, null, 2));
console.log("Created page-load-report.json with " + Object.keys(result).length + " chunks.");
