include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "../../../modules/network"
}

inputs = {
  cidr_block = "10.50.0.0/16"
  name       = "remote-state-fixture"
}
