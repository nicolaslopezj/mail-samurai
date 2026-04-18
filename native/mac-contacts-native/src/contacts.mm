#include <napi.h>

#import <Contacts/Contacts.h>
#import <Foundation/Foundation.h>

namespace {

void RunOnMainSync(dispatch_block_t fn) {
  if ([NSThread isMainThread]) {
    fn();
    return;
  }
  dispatch_sync(dispatch_get_main_queue(), ^{
    fn();
  });
}

std::string AuthStatusString(CNAuthorizationStatus status) {
  switch (status) {
  case CNAuthorizationStatusAuthorized:
    return "Authorized";
  case CNAuthorizationStatusDenied:
    return "Denied";
  case CNAuthorizationStatusRestricted:
    return "Restricted";
  case CNAuthorizationStatusNotDetermined:
  default:
    return "Not Determined";
  }
}

Napi::Object ContactToJs(Napi::Env env, CNContact *contact) {
  Napi::Object out = Napi::Object::New(env);
  out.Set("identifier", Napi::String::New(env, contact.identifier.UTF8String ?: ""));
  if (contact.givenName.length > 0) {
    out.Set("firstName", Napi::String::New(env, contact.givenName.UTF8String));
  }
  if (contact.middleName.length > 0) {
    out.Set("middleName", Napi::String::New(env, contact.middleName.UTF8String));
  }
  if (contact.familyName.length > 0) {
    out.Set("lastName", Napi::String::New(env, contact.familyName.UTF8String));
  }
  if (contact.nickname.length > 0) {
    out.Set("nickname", Napi::String::New(env, contact.nickname.UTF8String));
  }
  if (contact.organizationName.length > 0) {
    out.Set("organizationName",
            Napi::String::New(env, contact.organizationName.UTF8String));
  }

  NSString *fullName =
      [CNContactFormatter stringFromContact:contact
                                      style:CNContactFormatterStyleFullName];
  if (fullName.length > 0) {
    out.Set("name", Napi::String::New(env, fullName.UTF8String));
  }

  Napi::Array emails = Napi::Array::New(env);
  uint32_t index = 0;
  for (CNLabeledValue<NSString *> *value in contact.emailAddresses) {
    NSString *email = value.value;
    if (email.length == 0)
      continue;
    emails.Set(index++, Napi::String::New(env, email.UTF8String));
  }
  out.Set("emailAddresses", emails);
  return out;
}

} // namespace

Napi::Value GetAuthStatus(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  __block std::string status;
  RunOnMainSync(^{
    status = AuthStatusString(
        [CNContactStore authorizationStatusForEntityType:CNEntityTypeContacts]);
  });
  return Napi::String::New(env, status);
}

Napi::Promise RequestAccess(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);
  auto tsfn = Napi::ThreadSafeFunction::New(
      env, Napi::Function::New(env, [](const Napi::CallbackInfo &) {}),
      "requestContactsAccess", 0, 1);

  dispatch_async(dispatch_get_main_queue(), ^{
    CNContactStore *store = [[CNContactStore alloc] init];
    [store requestAccessForEntityType:CNEntityTypeContacts
                    completionHandler:^(BOOL granted, NSError *error) {
                      std::string *status =
                          new std::string(AuthStatusString(
                              [CNContactStore authorizationStatusForEntityType:
                                                  CNEntityTypeContacts]));

                      if (error != nil &&
                          status->compare("Not Determined") == 0) {
                        *status = "Denied";
                      }
                      if (granted) {
                        *status = "Authorized";
                      }

                      tsfn.BlockingCall(status,
                                        [deferred](Napi::Env env,
                                                   Napi::Function /*unused*/,
                                                   std::string *status) {
                                          deferred.Resolve(
                                              Napi::String::New(env, *status));
                                          delete status;
                                        });
                      tsfn.Release();
                    }];
  });

  return deferred.Promise();
}

Napi::Promise GetAllContacts(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);
  auto tsfn = Napi::ThreadSafeFunction::New(
      env, Napi::Function::New(env, [](const Napi::CallbackInfo &) {}),
      "getAllContacts", 0, 1);

  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    @autoreleasepool {
      CNAuthorizationStatus status =
          [CNContactStore authorizationStatusForEntityType:CNEntityTypeContacts];
      if (status != CNAuthorizationStatusAuthorized) {
        auto *errorText =
            new std::string("Contacts access not granted.");
        tsfn.BlockingCall(
            errorText,
            [deferred](Napi::Env env, Napi::Function /*unused*/,
                       std::string *errorText) {
              deferred.Reject(
                  Napi::Error::New(env, *errorText).Value());
              delete errorText;
            });
        tsfn.Release();
        return;
      }

      CNContactStore *store = [[CNContactStore alloc] init];
      NSArray<id<CNKeyDescriptor>> *keys = @[
        CNContactIdentifierKey, CNContactGivenNameKey, CNContactMiddleNameKey,
        CNContactFamilyNameKey, CNContactNicknameKey,
        CNContactOrganizationNameKey, CNContactEmailAddressesKey
      ];

      NSError *error = nil;
      NSMutableArray<CNContact *> *contacts = [NSMutableArray array];
      CNContactFetchRequest *request =
          [[CNContactFetchRequest alloc] initWithKeysToFetch:keys];
      BOOL ok = [store enumerateContactsWithFetchRequest:request
                                                  error:&error
                                             usingBlock:^(
                                                 CNContact *_Nonnull contact,
                                                 BOOL *_Nonnull stop) {
                                               [contacts addObject:contact];
                                             }];

      if (!ok || error != nil) {
        auto *errorText = new std::string(
            error.localizedDescription.UTF8String ?: "Failed to load contacts.");
        tsfn.BlockingCall(
            errorText,
            [deferred](Napi::Env env, Napi::Function /*unused*/,
                       std::string *errorText) {
              deferred.Reject(
                  Napi::Error::New(env, *errorText).Value());
              delete errorText;
            });
        tsfn.Release();
        return;
      }

      NSArray<CNContact *> *copied = [contacts copy];
      tsfn.BlockingCall(
          const_cast<void *>(CFBridgingRetain(copied)),
          [deferred](Napi::Env env, Napi::Function /*unused*/, void *retained) {
            NSArray<CNContact *> *contacts =
                static_cast<NSArray<CNContact *> *>(CFBridgingRelease(retained));
            Napi::Array out = Napi::Array::New(env, contacts.count);
            for (NSUInteger i = 0; i < contacts.count; ++i) {
              out.Set(static_cast<uint32_t>(i), ContactToJs(env, contacts[i]));
            }
            deferred.Resolve(out);
          });
      tsfn.Release();
    }
  });

  return deferred.Promise();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("getAuthStatus", Napi::Function::New(env, GetAuthStatus));
  exports.Set("requestAccess", Napi::Function::New(env, RequestAccess));
  exports.Set("getAllContacts", Napi::Function::New(env, GetAllContacts));
  return exports;
}

NODE_API_MODULE(mac_contacts_native, Init)
