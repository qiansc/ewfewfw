/**
 * Feat 业务逻辑入口
 */

export { featLifecycle } from './lifecycle.js';
export {
  featMerge,
  detectFeatConflicts,
  mergeFeatToMain,
  collectFeatEntitiesForVector,
} from './merge.js';
