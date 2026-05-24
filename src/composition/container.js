import * as firestore from "../data/firestore.js";
import { isOpenAiDirectModel, runGptImageEdit } from "../data/openaiImage.js";
import * as replicate from "../data/replicate.js";
import * as storage from "../data/storage.js";
import { createOrderService } from "../domain/orderService.js";

export const orderService = createOrderService({
  getOrder: firestore.getOrder,
  updatePhotoOutput: firestore.updatePhotoOutput,
  runImageEdit: replicate.runImageEdit,
  runGptImageEdit,
  isOpenAiDirectModel,
  uploadImageFromUrl: storage.uploadImageFromUrl,
});
