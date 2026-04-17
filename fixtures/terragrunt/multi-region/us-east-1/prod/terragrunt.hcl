include "root" {
  path = find_in_parent_folders()
}

dependency "vpc" {
  config_path = "../vpc"

  mock_outputs = {
    vpc_id     = "vpc-mock"
    subnet_ids = ["subnet-a", "subnet-b"]
  }
}

terraform {
  source = "../../../modules/app"
}

inputs = {
  environment = "prod"
  vpc_id      = dependency.vpc.outputs.vpc_id
  subnet_ids  = dependency.vpc.outputs.subnet_ids
}
