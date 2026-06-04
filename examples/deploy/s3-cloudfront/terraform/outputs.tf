output "bucket_name" {
  description = "S3 bucket that receives the Laurel dist/ upload."
  value       = aws_s3_bucket.site.bucket
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID for invalidations."
  value       = aws_cloudfront_distribution.site.id
}

output "cloudfront_domain_name" {
  description = "CloudFront domain name for DNS or smoke testing."
  value       = aws_cloudfront_distribution.site.domain_name
}
