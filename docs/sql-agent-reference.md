# SQL Agent Reference Library

A comprehensive look-back index of 25 diverse questions and their corresponding SQL queries for the SQL agent to reference and learn from. These examples cover various analytical patterns, SQL operations, and complexity levels based on the demo schema.

## Schema Reference
- **Table**: `agent_demo_orders`
- **Columns**: `id` (int8), `region` (text), `status` (text), `amount` (numeric), `created_at` (timestamptz)

---

## Basic Aggregations

### 1. Total Revenue by Region
**Question**: "Show me the total revenue by region"
```sql
SELECT region, SUM(amount) as total_revenue
FROM agent_demo_orders
GROUP BY region
ORDER BY total_revenue DESC;
```

### 2. Order Count by Status
**Question**: "What is the number of orders by status?"
```sql
SELECT status, COUNT(*) as order_count
FROM agent_demo_orders
GROUP BY status
ORDER BY order_count DESC;
```

### 3. Average Order Value
**Question**: "What is the average order value across all orders?"
```sql
SELECT AVG(amount) as average_order_value
FROM agent_demo_orders;
```

### 4. Average Order Value by Region
**Question**: "Show me the average order value for each region"
```sql
SELECT region, AVG(amount) as average_order_value
FROM agent_demo_orders
GROUP BY region
ORDER BY average_order_value DESC;
```

### 5. Maximum and Minimum Order Amounts
**Question**: "What are the highest and lowest order amounts?"
```sql
SELECT 
  MAX(amount) as highest_order_amount,
  MIN(amount) as lowest_order_amount
FROM agent_demo_orders;
```

---

## Filtering and Conditions

### 6. Revenue from Paid Orders Only
**Question**: "Show me the total revenue from paid orders only"
```sql
SELECT SUM(amount) as paid_revenue
FROM agent_demo_orders
WHERE status = 'paid';
```

### 7. Orders Above Average Value
**Question**: "Find all orders with amounts greater than the overall average"
```sql
SELECT id, region, status, amount
FROM agent_demo_orders
WHERE amount > (SELECT AVG(amount) FROM agent_demo_orders)
ORDER BY amount DESC;
```

### 8. Regional Revenue for Specific Status
**Question**: "Show revenue by region for paid orders only"
```sql
SELECT region, SUM(amount) as paid_revenue
FROM agent_demo_orders
WHERE status = 'paid'
GROUP BY region
ORDER BY paid_revenue DESC;
```

### 9. Recent Orders (Last 30 Days)
**Question**: "Show all orders from the last 30 days"
```sql
SELECT id, region, status, amount, created_at
FROM agent_demo_orders
WHERE created_at >= NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;
```

### 10. High Value Orders (Top 25%)
**Question**: "Identify orders in the top 25% by amount"
```sql
SELECT id, region, status, amount
FROM agent_demo_orders
WHERE amount >= (
  SELECT percentile_cont(0.75) WITHIN GROUP (ORDER BY amount)
  FROM agent_demo_orders
)
ORDER BY amount DESC;
```

---

## Time-Based Analysis

### 11. Daily Revenue Trend
**Question**: "Show the revenue trend by day"
```sql
SELECT 
  DATE(created_at) as order_date,
  SUM(amount) as daily_revenue
FROM agent_demo_orders
GROUP BY DATE(created_at)
ORDER BY order_date;
```

### 12. Monthly Revenue
**Question**: "What is the total revenue for each month?"
```sql
SELECT 
  DATE_TRUNC('month', created_at) as month,
  SUM(amount) as monthly_revenue
FROM agent_demo_orders
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month;
```

### 13. Weekly Revenue Breakdown
**Question**: "Show revenue broken down by week"
```sql
SELECT 
  DATE_TRUNC('week', created_at) as week,
  SUM(amount) as weekly_revenue
FROM agent_demo_orders
GROUP BY DATE_TRUNC('week', created_at)
ORDER BY week;
```

### 14. Orders by Day of Week
**Question**: "How many orders occur on each day of the week?"
```sql
SELECT 
  EXTRACT(DOW FROM created_at) as day_of_week,
  COUNT(*) as order_count
FROM agent_demo_orders
GROUP BY EXTRACT(DOW FROM created_at)
ORDER BY day_of_week;
```

### 15. Hourly Order Distribution
**Question**: "Show the distribution of orders by hour"
```sql
SELECT 
  EXTRACT(HOUR FROM created_at) as hour,
  COUNT(*) as order_count
FROM agent_demo_orders
GROUP BY EXTRACT(HOUR FROM created_at)
ORDER BY hour;
```

---

## Comparative Analysis

### 16. Revenue Percentage by Region
**Question**: "What percentage of total revenue does each region contribute?"
```sql
SELECT 
  region,
  SUM(amount) as regional_revenue,
  ROUND(SUM(amount) * 100.0 / SUM(SUM(amount)) OVER (), 2) as revenue_percentage
FROM agent_demo_orders
GROUP BY region
ORDER BY regional_revenue DESC;
```

### 17. Status Distribution by Region
**Question**: "Show the count and percentage of each status within each region"
```sql
SELECT 
  region,
  status,
  COUNT(*) as status_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY region), 2) as status_percentage
FROM agent_demo_orders
GROUP BY region, status
ORDER BY region, status_count DESC;
```

### 18. Regional Performance vs Average
**Question**: "Compare each region's average order value to the global average"
```sql
SELECT 
  region,
  AVG(amount) as regional_average,
  AVG(amount) - (SELECT AVG(amount) FROM agent_demo_orders) as difference_from_global_avg,
  ROUND(AVG(amount) * 100.0 / (SELECT AVG(amount) FROM agent_demo_orders), 2) as percentage_of_global_avg
FROM agent_demo_orders
GROUP BY region
ORDER BY regional_average DESC;
```

### 19. Top Regions by Order Count and Revenue
**Question**: "Which regions have both the highest order counts and highest revenue?"
```sql
SELECT 
  region,
  COUNT(*) as order_count,
  SUM(amount) as total_revenue,
  AVG(amount) as average_order_value
FROM agent_demo_orders
GROUP BY region
ORDER BY order_count DESC, total_revenue DESC;
```

### 20. Status Performance Comparison
**Question**: "Compare the average order value across different statuses"
```sql
SELECT 
  status,
  COUNT(*) as order_count,
  SUM(amount) as total_revenue,
  AVG(amount) as average_order_value,
  STDDEV(amount) as amount_stddev
FROM agent_demo_orders
GROUP BY status
ORDER BY average_order_value DESC;
```

---

## Advanced Analytics

### 21. Regional Ranking by Revenue
**Question**: "Rank regions by total revenue"
```sql
SELECT 
  region,
  SUM(amount) as total_revenue,
  RANK() OVER (ORDER BY SUM(amount) DESC) as revenue_rank
FROM agent_demo_orders
GROUP BY region
ORDER BY revenue_rank;
```

### 22. Moving Average of Daily Revenue
**Question**: "Show daily revenue with a 7-day moving average"
```sql
WITH daily_revenue AS (
  SELECT 
    DATE(created_at) as order_date,
    SUM(amount) as daily_revenue
  FROM agent_demo_orders
  GROUP BY DATE(created_at)
)
SELECT 
  order_date,
  daily_revenue,
  AVG(daily_revenue) OVER (
    ORDER BY order_date 
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) as moving_7day_avg
FROM daily_revenue
ORDER BY order_date;
```

### 23. Cumulative Revenue Over Time
**Question**: "Show the cumulative revenue over time"
```sql
SELECT 
  created_at,
  amount,
  SUM(amount) OVER (ORDER BY created_at) as cumulative_revenue
FROM agent_demo_orders
ORDER BY created_at;
```

### 24. Order Value Percentiles by Region
**Question**: "Calculate percentiles of order values within each region"
```sql
SELECT 
  region,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY amount) as p25,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY amount) as p50,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY amount) as p75,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY amount) as p90
FROM agent_demo_orders
GROUP BY region
ORDER BY region;
```

### 25. Identifying Outliers Using Standard Deviation
**Question**: "Find orders that are more than 2 standard deviations above the mean for their region"
```sql
WITH regional_stats AS (
  SELECT 
    region,
    AVG(amount) as avg_amount,
    STDDEV(amount) as stddev_amount
  FROM agent_demo_orders
  GROUP BY region
)
SELECT 
  o.id,
  o.region,
  o.status,
  o.amount,
  rs.avg_amount as regional_avg,
  rs.stddev_amount as regional_stddev,
  (o.amount - rs.avg_amount) / rs.stddev_amount as z_score
FROM agent_demo_orders o
JOIN regional_stats rs ON o.region = rs.region
WHERE o.amount > rs.avg_amount + (2 * rs.stddev_amount)
ORDER BY z_score DESC;
```

---

## Usage Notes

### Pattern Categories
- **Basic Aggregations** (1-5): SUM, COUNT, AVG, MAX, MIN
- **Filtering** (6-10): WHERE clauses, subqueries, percentiles
- **Time-Based** (11-15): Date functions, grouping by time periods
- **Comparative** (16-20): Window functions, percentages, comparisons
- **Advanced** (21-25): Ranking, moving averages, cumulative sums, statistical analysis

### Integration with SQL Agent
These examples can be used to:
1. **Few-shot learning**: Include relevant examples in the SQL agent's system prompt
2. **Pattern matching**: Match incoming questions to similar patterns in this library
3. **Template generation**: Use as templates for generating similar queries
4. **Validation**: Compare generated SQL against these examples for quality assurance

### Extending the Library
To add new examples:
1. Ensure questions cover diverse analytical patterns
2. Use dynamic SQL (no hardcoded values or dates)
3. Include comments explaining the analytical intent
4. Categorize by pattern type for easy reference
5. Test queries against the actual schema to ensure validity