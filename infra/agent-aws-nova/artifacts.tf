resource "aws_s3_bucket" "lambda_artifacts" {
  bucket = "${local.agent_name}-artifacts"
}

resource "aws_s3_bucket_versioning" "lambda_artifacts" {
  bucket = aws_s3_bucket.lambda_artifacts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "lambda_artifacts" {
  bucket = aws_s3_bucket.lambda_artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "lambda_artifacts" {
  bucket = aws_s3_bucket.lambda_artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Placeholder zip uploaded by Terraform so the Lambda can be created on
# the first `terraform apply` before any CI run has produced real code.
# CI replaces this via -var="agent_lambda_s3_key=aws-nova-SHA.zip".
data "archive_file" "placeholder" {
  type        = "zip"
  source_dir  = "${path.module}/functions/placeholder"
  output_path = "${path.module}/functions/.dist/aws-nova-placeholder.zip"
}

resource "aws_s3_object" "placeholder" {
  bucket = aws_s3_bucket.lambda_artifacts.bucket
  key    = "bootstrap/aws-nova-placeholder.zip"
  source = data.archive_file.placeholder.output_path
  etag   = data.archive_file.placeholder.output_md5
}
