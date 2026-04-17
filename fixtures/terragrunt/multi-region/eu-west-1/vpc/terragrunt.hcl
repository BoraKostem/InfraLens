include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "../../../modules/vpc"
}

inputs = {
  cidr_block = "10.20.0.0/16"
  name       = "infralens-fixture-eu-west-1"
}
