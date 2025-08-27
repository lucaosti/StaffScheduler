import { Router } from 'express';

const router = Router();

// TODO: Implement employee routes
router.get('/', (req, res) => {
  res.json({ message: 'Employees route - TODO' });
});

export default router;
