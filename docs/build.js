// Сборка PDF из HTML: node build.js  (нужен playwright с chromium)
const { chromium } = require('playwright');
const path = require('path');
const docs = [
  ['staff.html',   '../IrisTools/Инструкция для сотрудников.pdf'],
  ['install.html', '../IrisTools/Инструкция по установке.pdf'],
];
(async () => {
  const only = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [src, out] of docs) {
    if (only && !src.startsWith(only)) continue;
    await page.goto('file://' + path.resolve(__dirname, src), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: path.resolve(__dirname, out), format: 'A4', printBackground: true, preferCSSPageSize: true });
    console.log('ok', out);
  }
  await browser.close();
})();
