import { runImageEdit } from "./replicate.js";
import { uploadImageFromUrl } from "./storage.js";
import { getOrder, updatePhotoOutput } from "./firestore.js";
import { getPromptForPreset } from "./presets.js";

/**
 * Process a single photo through Replicate and save to Firebase Storage
 */
export async function processPhoto(orderId, photo, collectionName = "orders") {
  const { input_url, photo_id, preset, user_id } = photo;
  const userPrompt = photo.prompt; // user's raw text from the app

  if (!input_url || !photo_id) {
    throw new Error(`Photo missing input_url or photo_id: ${JSON.stringify(photo)}`);
  }

  // Use the user's typed prompt if provided, otherwise fall back to preset
  const prompt = userPrompt && userPrompt.trim()
    ? userPrompt.trim()
    : getPromptForPreset(preset || "portrait_enhance");
  console.log(`[Processor] Prompt for ${photo_id}: "${prompt}"`);

  // 1. Run Replicate image edit
  const replicateOutputUrl = await runImageEdit({
    inputImageUrl: input_url,
    prompt,
    aspectRatio: "match_input_image",
    outputFormat: "jpg",
    safetyTolerance: 2,
    promptUpsampling: false,
  });

  // 2. Upload to Firebase Storage
  const storagePath = `uploads/edited/${user_id}/${orderId}_${photo_id}.jpg`;
  const outputUrl = await uploadImageFromUrl(replicateOutputUrl, storagePath);

  // 3. Update Firestore with output URL
  await updatePhotoOutput(orderId, photo_id, outputUrl, collectionName);

  return { photo_id, output_url: outputUrl };
}

/**
 * Process all photos in an order
 */
export async function processOrder(orderId, collectionName = "orders") {
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
      console.log(`[Processor] ${photo.photo_id} done:`, result.output_url?.slice(0, 50) + "...");
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
