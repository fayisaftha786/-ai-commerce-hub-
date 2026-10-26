# Product ranking: evidence and limits

The CSV importer ranks only the data supplied by the user. It does not fetch Meesho or other marketplace data, and it cannot predict future purchases.

## Score components

- Orders supplied: up to 35 points, using a logarithmic scale.
- Orders divided by clicks: up to 20 points, when both are supplied and clicks are greater than zero.
- Product rating: up to 15 points.
- Review count: up to 10 points, using a logarithmic scale.
- Commission percentage: up to 10 points.
- Price band: up to 5 points. This is a simple heuristic, not proof of demand.
- In-stock status: 5 points.
- Return-rate penalty: subtract up to 20 points when both returns and orders are supplied and orders are greater than zero.

Missing metrics are not invented. In particular, a product with no order/click evidence receives a warning that its score reflects catalogue details rather than observed sales performance. Because data may be missing, scores are not necessarily comparable across rows with different columns or reporting windows.

## Before relying on a ranking

1. Use the same reporting period and metric definitions for every product.
2. Confirm that order, click and return counts refer to the same attribution window.
3. Verify price, stock, shipping, commission eligibility and return terms on the current listing/dashboard.
4. Treat high return rates, zero orders, small click counts and missing reporting periods as reasons to investigate.
5. Run a small content test and compare real affiliate-dashboard clicks, orders, cancellations and approved commission before scaling.

CSV files are parsed in the browser and saved in that browser's local storage. They are not uploaded to this application. Use only data you are authorised to access.
