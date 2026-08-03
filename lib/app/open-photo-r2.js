// Compatibility aliases for code and historical tests that still use the old R2 names.
// All active open-photo storage is handled by Backblaze B2.
export {
  openPhotoB2Limits as openPhotoR2Limits,
  openPhotoDifferenceHash,
  transformOpenPhotoForB2 as transformOpenPhotoForR2,
  storeOpenPhotoInB2 as storeOpenPhotoInR2
} from './open-photo-b2.js'
