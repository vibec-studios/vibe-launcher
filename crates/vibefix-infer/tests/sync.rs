use vibefix_infer::AnyModel;

#[test]
fn models_can_be_shared_between_threads() {
    fn shared<T: Send + Sync>() {}
    shared::<AnyModel>();
}
