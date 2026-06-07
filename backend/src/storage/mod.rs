use std::time::Duration;

use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use url::Url;

use crate::Config;

/// Thin wrapper around a rusty-s3 Bucket for generating presigned URLs and
/// executing server-side S3 operations (DELETE).
///
/// All presigned PUT/GET URLs are handed directly to clients — the relay never
/// proxies file bytes.  The S3_ENDPOINT in Config must therefore be the
/// *publicly-reachable* address (the one the user's browser can reach), not
/// an internal Docker/k8s address.
#[derive(Clone)]
pub struct StorageClient {
    bucket: Bucket,
    creds: Credentials,
}

impl StorageClient {
    /// Returns `None` when any of the five required S3 env vars are absent.
    pub fn from_config(config: &Config) -> Option<Self> {
        let endpoint  = config.s3_endpoint.as_deref()?;
        let bucket    = config.s3_bucket.as_deref()?;
        let region    = config.s3_region.as_deref().unwrap_or("us-east-1");
        let access    = config.s3_access_key.as_deref()?;
        let secret    = config.s3_secret_key.as_deref()?;

        let base = Url::parse(endpoint)
            .map_err(|e| tracing::error!(error = %e, "Invalid S3_ENDPOINT URL"))
            .ok()?;

        let creds = Credentials::new(access, secret);

        // rusty-s3 0.3 requires &'static str for bucket name and region.
        // Box::leak is acceptable here — the relay is a long-lived process and
        // these strings are initialised once at startup.
        let bucket_static: &'static str = Box::leak(bucket.to_string().into_boxed_str());
        let region_static: &'static str = Box::leak(region.to_string().into_boxed_str());

        // Path-style addressing (http://host/bucket/key) is the default for MinIO.
        let bucket = Bucket::new(base, UrlStyle::Path, bucket_static, region_static)
            .map_err(|e| tracing::error!(error = %e, "Failed to build S3 bucket"))
            .ok()?;

        tracing::info!("S3/MinIO storage client initialised");
        Some(StorageClient { bucket, creds })
    }

    /// Generate a presigned PUT URL valid for one hour.
    pub fn presign_put(&self, object_key: &str) -> String {
        let action = self.bucket.put_object(Some(&self.creds), object_key);
        action.sign(Duration::from_secs(3600)).to_string()
    }

    /// Generate a presigned GET URL valid for one hour.
    pub fn presign_get(&self, object_key: &str) -> String {
        let action = self.bucket.get_object(Some(&self.creds), object_key);
        action.sign(Duration::from_secs(3600)).to_string()
    }

    /// Delete an object from S3/MinIO using a relay-side signed DELETE request.
    pub async fn delete_object(&self, object_key: &str) -> Result<(), reqwest::Error> {
        let action = self.bucket.delete_object(Some(&self.creds), object_key);
        let url = action.sign(Duration::from_secs(300)).to_string();
        reqwest::Client::new()
            .delete(&url)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }
}
