variable "site_name" {
  description = "Short name used for AWS resource labels."
  type        = string
  default     = "laurel-site"
}

variable "aws_region" {
  description = "AWS region for the S3 bucket and Terraform AWS provider."
  type        = string
  default     = "us-east-1"
}

variable "bucket_name" {
  description = "Globally unique S3 bucket name that stores the built Laurel dist/ files."
  type        = string
}

variable "aliases" {
  description = "Optional CloudFront alternate domain names, such as [\"www.example.com\"]."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "Optional ACM certificate ARN in us-east-1 for CloudFront aliases. Leave null to use the default CloudFront certificate."
  type        = string
  default     = null
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}
