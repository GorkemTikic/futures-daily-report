/* Site configuration — edit this ONE file after you deploy the analytics Worker.
 *
 * analyticsUrl: your deployed Cloudflare Worker base URL, no trailing slash, e.g.
 *   "https://futures-report-analytics.<your-subdomain>.workers.dev"
 * Leave it "" (empty) and the site runs fine with analytics simply disabled.
 *
 * This file is loaded before the app, so changing it needs only a commit + push
 * (no rebuild). It is public by design — it holds no secrets. The admin token is
 * never stored here; it is typed into the Analytics tab and kept in your browser.
 */
window.FDR_CONFIG = {
  analyticsUrl: "",
};
