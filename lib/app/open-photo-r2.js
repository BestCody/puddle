// Compatibility aliases for code and historical tests that still use the old R2 names.
// New approved open-photo writes use Supabase public media; B2 helpers remain available
// under their explicit names for historical/back-office paths.
export {
  openPhotoB2Limits as openPhotoR2Limits,
  openPhotoDifferenceHash,
  transformOpenPhotoForB2 as transformOpenPhotoForR2
} from './open-photo-b2.js'
export { storeOpenPhotoInSupabase as storeOpenPhotoInR2 } from './open-photo-supabase.js'
