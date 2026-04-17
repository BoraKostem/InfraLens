include "root" {
  path = find_in_parent_folders()
}

include "common" {
  path   = "${get_repo_root()}/fixtures/terragrunt/nested-includes/_common/app.hcl"
  expose = true
}

dependencies {
  paths = ["../network"]
}

terraform {
  source = "../../../../modules/app"
}

inputs = {
  environment  = "prod"
  service_name = include.common.locals.service_name
}
