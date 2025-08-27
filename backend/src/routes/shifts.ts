import { Router } from 'express';

const router = Router();

// TODO: Implement shift routes
router.get('/', (req, res) => {
  res.json({ message: 'Shifts route - TODO' });
});

export default router;
