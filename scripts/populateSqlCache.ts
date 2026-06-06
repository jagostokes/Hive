/**
 * Populates the SQL cache with the 25 reference questions from the SQL agent reference library.
 * This provides a knowledge base of common analytical patterns that can be matched via semantic similarity.
 *
 * Run: npm run populate:cache
 *
 * Requires OPENROUTER_API_KEY + DATABASE_URL in .env
 */
import "dotenv/config";
import { getPool, closePool } from "../src/db/index.js";
import { cacheStore } from "../src/cache/index.js";

const referenceQuestions = [
  {
    question: "Show me the total revenue by region",
    sql: "SELECT region, SUM(amount) as total_revenue FROM agent_demo_orders GROUP BY region ORDER BY total_revenue DESC;"
  },
  {
    question: "What is the number of orders by status?",
    sql: "SELECT status, COUNT(*) as order_count FROM agent_demo_orders GROUP BY status ORDER BY order_count DESC;"
  },
  {
    question: "What is the average order value across all orders?",
    sql: "SELECT AVG(amount) as average_order_value FROM agent_demo_orders;"
  },
  {
    question: "Show me the average order value for each region",
    sql: "SELECT region, AVG(amount) as average_order_value FROM agent_demo_orders GROUP BY region ORDER BY average_order_value DESC;"
  },
  {
    question: "What are the highest and lowest order amounts?",
    sql: "SELECT MAX(amount) as highest_order_amount, MIN(amount) as lowest_order_amount FROM agent_demo_orders;"
  },
  {
    question: "Show me the total revenue from paid orders only",
    sql: "SELECT SUM(amount) as paid_revenue FROM agent_demo_orders WHERE status = 'paid';"
  },
  {
    question: "Find all orders with amounts greater than the overall average",
    sql: "SELECT id, region, status, amount FROM agent_demo_orders WHERE amount > (SELECT AVG(amount) FROM agent_demo_orders) ORDER BY amount DESC;"
  },
  {
    question: "Show revenue by region for paid orders only",
    sql: "SELECT region, SUM(amount) as paid_revenue FROM agent_demo_orders WHERE status = 'paid' GROUP BY region ORDER BY paid_revenue DESC;"
  },
  {
    question: "Show all orders from the last 30 days",
    sql: "SELECT id, region, status, amount, created_at FROM agent_demo_orders WHERE created_at >= NOW() - INTERVAL '30 days' ORDER BY created_at DESC;"
  },
  {
    question: "Identify orders in the top 25% by amount",
    sql: "SELECT id, region, status, amount FROM agent_demo_orders WHERE amount >= (SELECT percentile_cont(0.75) WITHIN GROUP (ORDER BY amount) FROM agent_demo_orders) ORDER BY amount DESC;"
  },
  {
    question: "Show the revenue trend by day",
    sql: "SELECT DATE(created_at) as order_date, SUM(amount) as daily_revenue FROM agent_demo_orders GROUP BY DATE(created_at) ORDER BY order_date;"
  },
  {
    question: "What is the total revenue for each month?",
    sql: "SELECT DATE_TRUNC('month', created_at) as month, SUM(amount) as monthly_revenue FROM agent_demo_orders GROUP BY DATE_TRUNC('month', created_at) ORDER BY month;"
  },
  {
    question: "Show revenue broken down by week",
    sql: "SELECT DATE_TRUNC('week', created_at) as week, SUM(amount) as weekly_revenue FROM agent_demo_orders GROUP BY DATE_TRUNC('week', created_at) ORDER BY week;"
  },
  {
    question: "How many orders occur on each day of the week?",
    sql: "SELECT EXTRACT(DOW FROM created_at) as day_of_week, COUNT(*) as order_count FROM agent_demo_orders GROUP BY EXTRACT(DOW FROM created_at) ORDER BY day_of_week;"
  },
  {
    question: "Show the distribution of orders by hour",
    sql: "SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as order_count FROM agent_demo_orders GROUP BY EXTRACT(HOUR FROM created_at) ORDER BY hour;"
  },
  {
    question: "What percentage of total revenue does each region contribute?",
    sql: "SELECT region, SUM(amount) as regional_revenue, ROUND(SUM(amount) * 100.0 / SUM(SUM(amount)) OVER (), 2) as revenue_percentage FROM agent_demo_orders GROUP BY region ORDER BY regional_revenue DESC;"
  },
  {
    question: "Show the count and percentage of each status within each region",
    sql: "SELECT region, status, COUNT(*) as status_count, ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY region), 2) as status_percentage FROM agent_demo_orders GROUP BY region, status ORDER BY region, status_count DESC;"
  },
  {
    question: "Compare each region's average order value to the global average",
    sql: "SELECT region, AVG(amount) as regional_average, AVG(amount) - (SELECT AVG(amount) FROM agent_demo_orders) as difference_from_global_avg, ROUND(AVG(amount) * 100.0 / (SELECT AVG(amount) FROM agent_demo_orders), 2) as percentage_of_global_avg FROM agent_demo_orders GROUP BY region ORDER BY regional_average DESC;"
  },
  {
    question: "Which regions have both the highest order counts and highest revenue?",
    sql: "SELECT region, COUNT(*) as order_count, SUM(amount) as total_revenue, AVG(amount) as average_order_value FROM agent_demo_orders GROUP BY region ORDER BY order_count DESC, total_revenue DESC;"
  },
  {
    question: "Compare the average order value across different statuses",
    sql: "SELECT status, COUNT(*) as order_count, SUM(amount) as total_revenue, AVG(amount) as average_order_value, STDDEV(amount) as amount_stddev FROM agent_demo_orders GROUP BY status ORDER BY average_order_value DESC;"
  },
  {
    question: "Rank regions by total revenue",
    sql: "SELECT region, SUM(amount) as total_revenue, RANK() OVER (ORDER BY SUM(amount) DESC) as revenue_rank FROM agent_demo_orders GROUP BY region ORDER BY revenue_rank;"
  },
  {
    question: "Show daily revenue with a 7-day moving average",
    sql: "WITH daily_revenue AS (SELECT DATE(created_at) as order_date, SUM(amount) as daily_revenue FROM agent_demo_orders GROUP BY DATE(created_at)) SELECT order_date, daily_revenue, AVG(daily_revenue) OVER (ORDER BY order_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as moving_7day_avg FROM daily_revenue ORDER BY order_date;"
  },
  {
    question: "Show the cumulative revenue over time",
    sql: "SELECT created_at, amount, SUM(amount) OVER (ORDER BY created_at) as cumulative_revenue FROM agent_demo_orders ORDER BY created_at;"
  },
  {
    question: "Calculate percentiles of order values within each region",
    sql: "SELECT region, percentile_cont(0.25) WITHIN GROUP (ORDER BY amount) as p25, percentile_cont(0.50) WITHIN GROUP (ORDER BY amount) as p50, percentile_cont(0.75) WITHIN GROUP (ORDER BY amount) as p75, percentile_cont(0.90) WITHIN GROUP (ORDER BY amount) as p90 FROM agent_demo_orders GROUP BY region ORDER BY region;"
  },
  {
    question: "Find orders that are more than 2 standard deviations above the mean for their region",
    sql: "WITH regional_stats AS (SELECT region, AVG(amount) as avg_amount, STDDEV(amount) as stddev_amount FROM agent_demo_orders GROUP BY region) SELECT o.id, o.region, o.status, o.amount, rs.avg_amount as regional_avg, rs.stddev_amount as regional_stddev, (o.amount - rs.avg_amount) / rs.stddev_amount as z_score FROM agent_demo_orders o JOIN regional_stats rs ON o.region = rs.region WHERE o.amount > rs.avg_amount + (2 * rs.stddev_amount) ORDER BY z_score DESC;"
  }
];

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY || !process.env.DATABASE_URL) {
    console.error("Set OPENROUTER_API_KEY and DATABASE_URL in .env first.");
    process.exit(1);
  }

  const pool = getPool();
  
  console.log(`Populating SQL cache with ${referenceQuestions.length} reference questions...\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < referenceQuestions.length; i++) {
    const { question, sql } = referenceQuestions[i];
    
    try {
      const id = await cacheStore(question, sql, { pool, wasSuccessful: true });
      console.log(`[${i + 1}/${referenceQuestions.length}] ✓ Cached: "${question.substring(0, 60)}..." (ID: ${id})`);
      successCount++;
    } catch (err) {
      console.log(`[${i + 1}/${referenceQuestions.length}] ✗ Failed: "${question.substring(0, 60)}..."`);
      console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
      failCount++;
    }
  }

  console.log(`\n✓ Successfully cached: ${successCount}/${referenceQuestions.length}`);
  if (failCount > 0) {
    console.log(`✗ Failed: ${failCount}/${referenceQuestions.length}`);
  }

  await closePool();
}

main().catch((err) => {
  console.error(err);
  closePool().finally(() => process.exit(1));
});