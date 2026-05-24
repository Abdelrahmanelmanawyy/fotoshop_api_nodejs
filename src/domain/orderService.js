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
 * Factory: order processing with injected data-layer adapters (ports).
 * Domain orchestrates business rules; it does not import firebase/replicate/axios.
 *
 * @param {object} deps
 * @param {Function} deps.runImageEdit
 * @param {Function} deps.uploadImageFromUrl
 * @param {Function} deps.getOrder
 * @param {Function} deps.updatePhotoOutput
 */
export function createOrderService(deps) {
  const { runImageEdit, uploadImageFromUrl, getOrder, updatePhotoOutput } = deps;

  /**
   * Process a single photo through Replicate and persist to Storage + Firestore.
   */
  async function processPhoto(orderId, photo, collectionName = "orders") {
    const { input_url, photo_id, user_id } = photo;

    if (!input_url || !photo_id) {
      throw new Error(`Photo missing input_url or photo_id: ${JSON.stringify(photo)}`);
    }

    const prompt = resolveEditPrompt(photo);
    console.log(`[Processor] Prompt for ${photo_id}: "${prompt}"`);

    const replicateOutputUrl = await runImageEdit({
      inputImageUrl: input_url,
      prompt,
      aspectRatio: "match_input_image",
      outputFormat: "jpg",
      safetyTolerance: 2,
      promptUpsampling: false,
    });

    const storagePath = `uploads/edited/${user_id}/${orderId}_${photo_id}.jpg`;
    const outputUrl = await uploadImageFromUrl(replicateOutputUrl, storagePath);

    await updatePhotoOutput(orderId, photo_id, outputUrl, collectionName);

    return { photo_id, output_url: outputUrl };
  }

  /**
   * Process all photos in an order.
   */
  async function processOrder(orderId, collectionName = "orders") {
    console.log(`[Processor] Fetching order ${orderId}...`);
    const order = await getOrder(orderId, collectionName);

    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    const { photos = [] } = order;
    console.log(`[Processor] Order has ${photos.length} photo(s), starting Replicate...`);

    if (photos.length === 0) {
      throw new Error(`Order ${orderId} has no photos`);
    }

    const results = [];

    for (const photo of photos) {
      try {
        console.log(`[Processor] Processing ${photo.photo_id} (Replicate + Storage)...`);
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

    console.log(`[Processor] Order ${orderId} finished:`, results);
    return { order_id: orderId, results };
  }

  return { processPhoto, processOrder };
}
