export type MacContact = {
  identifier: string
  firstName?: string
  middleName?: string
  lastName?: string
  nickname?: string
  name?: string
  organizationName?: string
  emailAddresses?: string[]
}

export function requestAccess(): Promise<string>
export function getAuthStatus(): string
export function getAllContacts(): Promise<MacContact[]>
