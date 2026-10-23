terraform {
  required_version = ">= 1.12.0, < 1.13.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66.0"
    }
  }
}

provider "aws" {
  region = "ap-southeast-1"
}
