// Temporary compatibility names used by the open-photo importer.
// Storage and image normalization are Supabase-only.
export {
  openPhotoSupabaseDifferenceHash as openPhotoDifferenceHash,
  transformOpenPhotoForSupabase as transformOpenPhotoForR2,
  storeOpenPhotoInSupabase as storeOpenPhotoInR2
} from './open-photo-supabase.js'
