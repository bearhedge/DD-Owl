/**
 * IPO Tracker API Routes
 *
 * Endpoints for accessing IPO deal and bank data
 */

import { Router, Request, Response } from 'express';
import pg from 'pg';

const { Pool } = pg;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:DOMRD7x7ECUny4Pc615y9w==@35.194.142.132:5432/ddowl',
  ssl: { rejectUnauthorized: false },
});

export const ipoRouter = Router();

/**
 * GET /api/ipo/pipeline
 * Returns active IPO pipeline with bank assignments
 */
ipoRouter.get('/pipeline', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT * FROM ipo_pipeline
      ORDER BY filing_date DESC
      LIMIT 100
    `);
    res.json({
      count: result.rows.length,
      deals: result.rows,
    });
  } catch (err) {
    console.error('Pipeline query error:', err);
    res.status(500).json({ error: 'Failed to fetch pipeline' });
  }
});

/**
 * GET /api/ipo/deals
 * Returns all deals with optional filters
 */
ipoRouter.get('/deals', async (req: Request, res: Response) => {
  const { status, board, bank_id, limit = 50 } = req.query;

  try {
    let query = `
      SELECT
        d.id,
        d.board,
        d.status,
        d.filing_date,
        d.listing_date,
        d.hkex_app_id,
        c.name_en as company_name,
        c.name_cn as company_name_cn,
        c.sector,
        json_agg(json_build_object(
          'bank_id', b.id,
          'bank_name', b.name,
          'short_name', b.short_name,
          'roles', da.roles,
          'raw_role', da.raw_role,
          'is_lead', da.is_lead
        )) FILTER (WHERE b.id IS NOT NULL) as banks,
        array_agg(DISTINCT da.source_url) FILTER (WHERE da.source_url IS NOT NULL) as pdf_links
      FROM deals d
      JOIN companies c ON c.id = d.company_id
      LEFT JOIN deal_appointments da ON da.deal_id = d.id
      LEFT JOIN banks b ON b.id = da.bank_id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND d.status = $${paramIndex++}`;
      params.push(status);
    }

    if (board) {
      query += ` AND d.board = $${paramIndex++}`;
      params.push(board);
    }

    if (bank_id) {
      query += ` AND EXISTS (SELECT 1 FROM deal_appointments WHERE deal_id = d.id AND bank_id = $${paramIndex++})`;
      params.push(bank_id);
    }

    query += `
      GROUP BY d.id, c.id
      ORDER BY d.filing_date DESC
      LIMIT $${paramIndex}
    `;
    params.push(Number(limit));

    const result = await pool.query(query, params);
    res.json({
      count: result.rows.length,
      deals: result.rows,
    });
  } catch (err) {
    console.error('Deals query error:', err);
    res.status(500).json({ error: 'Failed to fetch deals' });
  }
});

/**
 * GET /api/ipo/deals/:id
 * Returns single deal with full details
 */
ipoRouter.get('/deals/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const dealResult = await pool.query(`
      SELECT
        d.*,
        c.name_en as company_name,
        c.name_cn as company_name_cn,
        c.sector,
        c.incorporation_place
      FROM deals d
      JOIN companies c ON c.id = d.company_id
      WHERE d.id = $1
    `, [id]);

    if (dealResult.rows.length === 0) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }

    const appointmentsResult = await pool.query(`
      SELECT
        da.*,
        b.name as bank_name,
        b.short_name,
        b.tier
      FROM deal_appointments da
      JOIN banks b ON b.id = da.bank_id
      WHERE da.deal_id = $1
      ORDER BY da.is_lead DESC, da.role
    `, [id]);

    const announcementsResult = await pool.query(`
      SELECT * FROM oc_announcements
      WHERE deal_id = $1
      ORDER BY announcement_date DESC
    `, [id]);

    res.json({
      deal: dealResult.rows[0],
      appointments: appointmentsResult.rows,
      announcements: announcementsResult.rows,
    });
  } catch (err) {
    console.error('Deal detail error:', err);
    res.status(500).json({ error: 'Failed to fetch deal' });
  }
});

/**
 * GET /api/ipo/banks
 * Returns all banks with deal statistics
 */
ipoRouter.get('/banks', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT * FROM bank_rankings
      ORDER BY total_deals DESC
    `);
    res.json({
      count: result.rows.length,
      banks: result.rows,
    });
  } catch (err) {
    console.error('Banks query error:', err);
    res.status(500).json({ error: 'Failed to fetch banks' });
  }
});

/**
 * GET /api/ipo/banks/:id
 * Returns single bank with all deals
 */
ipoRouter.get('/banks/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const bankResult = await pool.query(`
      SELECT * FROM banks WHERE id = $1
    `, [id]);

    if (bankResult.rows.length === 0) {
      res.status(404).json({ error: 'Bank not found' });
      return;
    }

    const dealsResult = await pool.query(`
      SELECT
        da.roles,
        da.is_lead,
        da.appointed_date,
        d.id as deal_id,
        d.status,
        d.board,
        d.filing_date,
        c.name_en as company_name,
        c.name_cn as company_name_cn
      FROM deal_appointments da
      JOIN deals d ON d.id = da.deal_id
      JOIN companies c ON c.id = d.company_id
      WHERE da.bank_id = $1
      ORDER BY d.filing_date DESC
    `, [id]);

    res.json({
      bank: bankResult.rows[0],
      deals: dealsResult.rows,
    });
  } catch (err) {
    console.error('Bank detail error:', err);
    res.status(500).json({ error: 'Failed to fetch bank' });
  }
});

/**
 * GET /api/ipo/stats
 * Returns dashboard summary statistics
 */
ipoRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const statsResult = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM deals WHERE status = 'active') as active_deals,
        (SELECT COUNT(*) FROM deals WHERE status = 'listed') as listed_deals,
        (SELECT COUNT(*) FROM banks) as total_banks,
        (SELECT COUNT(*) FROM companies) as total_companies,
        (SELECT COUNT(*) FROM deal_appointments WHERE is_lead = true) as lead_appointments
    `);

    const recentDealsResult = await pool.query(`
      SELECT
        d.id,
        c.name_en as company_name,
        d.filing_date,
        d.status
      FROM deals d
      JOIN companies c ON c.id = d.company_id
      ORDER BY d.created_at DESC
      LIMIT 5
    `);

    const topBanksResult = await pool.query(`
      SELECT bank_name, short_name, total_deals
      FROM bank_rankings
      ORDER BY total_deals DESC
      LIMIT 5
    `);

    res.json({
      summary: statsResult.rows[0],
      recentDeals: recentDealsResult.rows,
      topBanks: topBanksResult.rows,
    });
  } catch (err) {
    console.error('Stats query error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * POST /api/ipo/scrape
 * Triggers a new scrape run (manual trigger)
 */
ipoRouter.post('/scrape', async (req: Request, res: Response) => {
  try {
    // Import scraper dynamically to avoid circular deps
    const { scrapeActiveOCData, closeBrowser } = await import('./hkex-scraper.js');

    // Create scrape run record
    const runResult = await pool.query(`
      INSERT INTO scrape_runs (source, board, status)
      VALUES ('hkex', 'mainBoard', 'running')
      RETURNING id
    `);
    const runId = runResult.rows[0].id;

    // Run scraper in background
    res.json({
      message: 'Scrape started',
      runId,
      status: 'running',
    });

    // Continue scraping after response
    try {
      const data = await scrapeActiveOCData();

      let newDeals = 0;
      let newAppointments = 0;

      for (const item of data) {
        // Upsert company
        const companyResult = await pool.query(`
          INSERT INTO companies (name_en, name_cn)
          VALUES ($1, $2)
          ON CONFLICT (name_en) DO UPDATE SET name_cn = EXCLUDED.name_cn
          RETURNING id
        `, [item.company, item.companyChineseName || null]);
        const companyId = companyResult.rows[0]?.id;

        if (companyId) {
          // Upsert deal
          const dealResult = await pool.query(`
            INSERT INTO deals (company_id, filing_date, status)
            VALUES ($1, $2, 'active')
            ON CONFLICT DO NOTHING
            RETURNING id
          `, [companyId, item.appointmentDate || null]);

          const dealId = dealResult.rows[0]?.id;
          if (dealId) {
            newDeals++;

            // Insert bank appointments
            for (const bank of item.banks) {
              // Upsert bank
              const bankResult = await pool.query(`
                INSERT INTO banks (name)
                VALUES ($1)
                ON CONFLICT (name) DO NOTHING
                RETURNING id
              `, [bank.bank]);

              let bankId = bankResult.rows[0]?.id;
              if (!bankId) {
                const existingBank = await pool.query(
                  'SELECT id FROM banks WHERE name = $1',
                  [bank.bank]
                );
                bankId = existingBank.rows[0]?.id;
              }

              if (bankId) {
                // Convert role to array format (handle both old and new formats)
                const bankAny = bank as any;
                const roles = Array.isArray(bankAny.roles)
                  ? bankAny.roles.map((r: string) => r.toLowerCase())
                  : [bankAny.role?.toLowerCase() || 'other'];

                await pool.query(`
                  INSERT INTO deal_appointments (deal_id, bank_id, roles, is_lead, source_url)
                  VALUES ($1, $2, $3::bank_role[], $4, $5)
                  ON CONFLICT DO NOTHING
                `, [dealId, bankId, roles, bank.isLead, item.sourceUrl]);
                newAppointments++;
              }
            }
          }
        }
      }

      // Update run status
      await pool.query(`
        UPDATE scrape_runs
        SET completed_at = NOW(),
            status = 'completed',
            announcements_found = $2,
            announcements_parsed = $2,
            new_deals = $3,
            new_appointments = $4
        WHERE id = $1
      `, [runId, data.length, newDeals, newAppointments]);

      await closeBrowser();
    } catch (scrapeErr) {
      console.error('Scrape error:', scrapeErr);
      await pool.query(`
        UPDATE scrape_runs
        SET completed_at = NOW(),
            status = 'failed',
            errors = $2
        WHERE id = $1
      `, [runId, JSON.stringify({ error: String(scrapeErr) })]);
    }
  } catch (err) {
    console.error('Scrape trigger error:', err);
    res.status(500).json({ error: 'Failed to start scrape' });
  }
});

/**
 * GET /api/ipo/validations
 * Returns all validation statuses
 */
ipoRouter.get('/validations', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT deal_id, is_correct, notes, validated_at
      FROM deal_validations
      ORDER BY validated_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Validations query error:', err);
    res.status(500).json({ error: 'Failed to fetch validations' });
  }
});

/**
 * POST /api/ipo/validate/:id
 * Mark a deal as correct or wrong
 */
ipoRouter.post('/validate/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { is_correct, notes } = req.body;

  try {
    await pool.query(`
      INSERT INTO deal_validations (deal_id, is_correct, notes, validated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (deal_id) DO UPDATE SET
        is_correct = EXCLUDED.is_correct,
        notes = EXCLUDED.notes,
        validated_at = NOW()
    `, [id, is_correct, notes || null]);

    res.json({ success: true, deal_id: id, is_correct });
  } catch (err) {
    console.error('Validation error:', err);
    res.status(500).json({ error: 'Failed to save validation' });
  }
});

export default ipoRouter;
