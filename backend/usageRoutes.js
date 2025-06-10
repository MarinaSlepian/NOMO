import express from 'express';
import { incrementCounter, getAllCounters } from '../usage-db.js';

const router = express.Router();

router.post('/increment', async (req, res) => {
  const { optionId } = req.body;

  try {
    await incrementCounter(optionId);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Failed to update counter:', err);
    res.status(400).json({ error: err.message || 'Failed to update counter' });
  }
});

// Optional: Add GET route for stats
router.get('/counters', async (req, res) => {
  try {
    const counters = await getAllCounters();
    res.json(counters);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve counters' });
  }
});

export default router;
