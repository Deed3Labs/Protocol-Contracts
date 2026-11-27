import { Router, type Request, type Response } from 'express';
import { memberAvatarStore } from '../services/memberAvatarStore.js';

/*
 * Public avatar serving: GET /api/avatars/:memberId → the member's stored image. Public so <img>
 * tags load it without auth (avatars are display assets). Upload/delete live behind auth in
 * routes/members.ts (/me/avatar).
 */
const router = Router();

router.get('/:memberId', async (req: Request, res: Response) => {
  const memberId = Number(req.params.memberId);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    res.status(400).end();
    return;
  }
  try {
    const avatar = await memberAvatarStore.get(memberId);
    if (!avatar) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', avatar.contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(avatar.data);
  } catch {
    res.status(500).end();
  }
});

export default router;
