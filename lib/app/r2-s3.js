// Compatibility aliases for code and historical migrations that still use the old R2 names.
// All active storage requests are handled by Backblaze B2.
export {
  b2Configuration as r2Configuration,
  b2PublicUrl as r2PublicUrl,
  signB2Request as signR2Request,
  b2Request as r2Request,
  putB2Object as putR2Object,
  headB2Object as headR2Object,
  deleteB2Object as deleteR2Object,
  listB2Objects as listR2Objects
} from './b2-s3.js'
