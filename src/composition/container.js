import * as firestore from "../data/firestore.js";
import * as replicate from "../data/replicate.js";
import * as storage from "../data/storage.js";
import { createOrderService } from "../domain/orderService.js";

/**
 * Composition root: wires domain use cases to data implementations.
 */
export const orderService = createOrderService({
  getOrder: firestore.getOrder,
  updatePhotoOutput: firestore.updatePhotoOutput,
  runImageEdit: replicate.runImageEdit,
  uploadImageFromUrl: storage.uploadImageFromUrl,
});
