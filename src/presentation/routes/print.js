import { Router } from "express";
import { getSupabase } from "../../config/supabase.js";
import { parseImageUrls } from "../../core/imageUrls.js";
import { createFreePrint } from "../../domain/freePrintService.js";
import { normalizePaperFinish } from "../../domain/printPricingService.js";
import { resolveUserId } from "../middleware/auth.js";

const router = Router();

/**
 * POST /print/free
 * Body: { boothCode, imageUrls: string[] (or imageUrl), paperFinish?, couponCode?, uid? }
 *
 * Queues a print paid for by free prints (no couponCode) or by a coupon that covers
 * the full price. Paid prints go through /paytr/token instead.
 * 200: { jobIds }   400: invalid input / coupon   409: no free prints / coupon used up
 */
router.post("/free", async (req, res) => {
  try {
    const who = resolveUserId(req, req.body?.uid);
    if (!who.ok) return res.status(who.status).json({ error: who.error });

    const { boothCode, paperFinish = "glossy", couponCode } = req.body ?? {};
    if (typeof boothCode !== "string" || !boothCode.trim()) {
      return res.status(400).json({ error: "boothCode is required" });
    }

    const paper = normalizePaperFinish(paperFinish);
    if (!paper) return res.status(400).json({ error: "invalid paperFinish" });

    const { imageUrls, error: urlsError } = parseImageUrls(req.body ?? {}, { ownStorageOnly: true });
    if (urlsError) return res.status(400).json({ error: urlsError });

    if (couponCode !== undefined && (typeof couponCode !== "string" || !couponCode.trim())) {
      return res.status(400).json({ error: "invalid couponCode" });
    }

    const result = await createFreePrint(getSupabase(), {
      uid: who.uid,
      boothCode: boothCode.trim(),
      paperFinish: paper,
      imageUrls,
      couponCode: couponCode?.trim(),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    console.log(`[Print] free print queued for ${who.uid}: ${result.jobIds.length} job(s)`);
    return res.json({ jobIds: result.jobIds });
  } catch (err) {
    console.error("[Print] free print error:", err.message);
    return res.status(500).json({ error: "free_print_failed" });
  }
});

export default router;
