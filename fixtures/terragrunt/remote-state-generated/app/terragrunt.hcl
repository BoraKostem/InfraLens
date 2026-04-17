include "root" {
  path = find_in_parent_folders()
}

dependency "network" {
  config_path = "../network"

  mock_outputs = {
    vpc_id     = "vpc-mock"
    subnet_ids = ["subnet-a", "subnet-b"]
  }
}

terraform {
  source = "../../../modules/app"
}

inputs = {
  vpc_id     = dependency.network.outputs.vpc_id
  subnet_ids = dependency.network.outputs.subnet_ids
  service    = "remote-state-app"
}
