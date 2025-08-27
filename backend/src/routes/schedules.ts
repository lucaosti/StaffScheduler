import { Router } from 'express';

const router = Router();

// TODO: Implement schedule routes
router.get('/', (req, res) => {
  res.json({ message: 'Schedules route - TODO' });
});

export default router;
