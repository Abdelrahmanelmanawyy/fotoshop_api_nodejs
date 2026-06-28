import { getPromptForPreset } from "./presets.js";

/**
 * Builds the edit prompt for a photo (user text wins over preset fallback).
 * @param {object} photo
 */
export function resolveEditPrompt(photo) {
  const userPrompt = photo.prompt;
  if (userPrompt && String(userPrompt).trim()) {
    return String(userPrompt).trim();
  }
  return getPromptForPreset(photo.preset || "portrait_enhance");
}

/**
 * @param {object} deps
 * @param {Function} deps.runImageEdit
 * @param {Function} deps.runGptImageEdit
 * @param {Function} deps.isOpenAiDirectModel
 * @param {Function} deps.uploadImageFromUrl
 * @param {Function} deps.getOrder
 * @param {Function} deps.updatePhotoOutput
 */
export function createOrderService(deps) {
  const {
    runImageEdit,
    runGptImageEdit,
    isOpenAiDirectModel,
    uploadImageFromUrl,
    getOrder,
    updatePhotoOutput,
    // Optional — present in production wiring, omitted in some unit tests.
    setOrderStatus = async () => {},
    refundOrder = async () => false,
  } = deps;

  async function processPhoto(orderId, photo, collectionName = "orders") {
    const { input_url, photo_id, user_id } = photo;

    if (!input_url || !photo_id) {
      throw new Error(`Photo missing input_url or photo_id: ${JSON.stringify(photo)}`);
    }

    const modelLabel = photo.replicate_model || "(REPLICATE_MODEL env default)";
    const prompt = resolveEditPrompt(photo);
    console.log(`[Processor] ${photo_id} model=${modelLabel}`);
    console.log(`[Processor] Prompt for ${photo_id}: "${prompt}"`);

    const storagePath = `uploads/edited/${user_id}/${orderId}_${photo_id}.jpg`;
    let outputUrl;

    if (isOpenAiDirectModel(photo.replicate_model)) {
      console.log(`[Processor] ${photo_id} using OpenAI API gpt-image-1`);
      outputUrl = await runGptImageEdit({
        inputImageUrl: input_url,
        prompt,
        storagePath,
      });
    } else {
      const replicateOutputUrl = await runImageEdit({
        inputImageUrl: input_url,
        prompt,
        model: photo.replicate_model,
        aspectRatio: "match_input_image",
        outputFormat: "jpg",
        safetyTolerance: 2,
        promptUpsampling: false,
      });
      outputUrl = await uploadImageFromUrl(replicateOutputUrl, storagePath);
    }

    await updatePhotoOutput(orderId, photo_id, outputUrl, collectionName);
    return { photo_id, output_url: outputUrl };
  }

  async function processOrder(orderId, collectionName = "orders") {
    console.log(`[Processor] Fetching order ${orderId}...`);
    const order = await getOrder(orderId, collectionName);

    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    const { photos = [] } = order;
    console.log(`[Processor] Order has ${photos.length} photo(s), starting...`);

    if (photos.length === 0) {
      // No work and nothing to deliver — refund whatever was charged.
      await refundOrder(orderId);
      throw new Error(`Order ${orderId} has no photos`);
    }

    // Mark in-flight (also increments attempts) so the reconciliation sweeper
    // and the client can distinguish "being worked on" from "stuck pending".
    await setOrderStatus(orderId, "processing");

    const results = [];

    for (const photo of photos) {
      try {
        // Idempotent re-runs (e.g. from the sweeper): skip photos already done.
        if (photo.output_url) {
          results.push({ success: true, photo_id: photo.photo_id, output_url: photo.output_url });
          continue;
        }
        console.log(`[Processor] Processing ${photo.photo_id}...`);
        const result = await processPhoto(orderId, photo, collectionName);
        console.log(
          `[Processor] ${photo.photo_id} done:`,
          result.output_url?.slice(0, 50) + "..."
        );
        results.push({ success: true, ...result });
      } catch (err) {
        console.error(`[Processor] ${photo.photo_id} failed:`, err.message);
        results.push({
          success: false,
          photo_id: photo.photo_id,
          error: err.message,
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const total = results.length;

    if (succeeded === 0) {
      // Every photo failed → the user got nothing → refund their credits.
      const firstError = results.find((r) => !r.success)?.error ?? "all photos failed";
      const refunded = await refundOrder(orderId);
      if (!refunded) {
        // Refund itself failed — leave as 'failed' so the sweeper retries it.
        await setOrderStatus(orderId, "failed", `refund_failed: ${firstError}`);
      }
      // refundOrder set status='refunded' on success.
      console.error(`[Processor] Order ${orderId} fully failed (0/${total}) → refund=${refunded}`);
    } else if (succeeded < total) {
      // Partial success. Policy (PRODUCTION_READINESS_PLAN §1.5): single-photo AI
      // orders are all-or-nothing so this only affects multi-photo orders; we
      // keep the order completed and surface the failures in the response.
      await setOrderStatus(orderId, "completed", `partial: ${total - succeeded}/${total} failed`);
    } else {
      await setOrderStatus(orderId, "completed");
    }

    console.log(`[Processor] Order ${orderId} finished: ${succeeded}/${total} ok`);
    return { order_id: orderId, results };
  }

  return { processPhoto, processOrder };
}
