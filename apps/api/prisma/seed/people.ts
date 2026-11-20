/**
 * People seed: faculty for every department (with heads and deans) and about
 * 2,000 students across programs. Deterministic (seeded PRNG) and idempotent
 * (keyed by email, `skipDuplicates`). All seeded accounts share the dev password.
 */
import type {
  FacultyDesignation,
  HoldType,
  StudentStatus,
} from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261120);
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;

const FIRST = [
  'Aarav',
  'Aditi',
  'Aditya',
  'Ananya',
  'Arjun',
  'Diya',
  'Ishaan',
  'Kavya',
  'Krishna',
  'Meera',
  'Neha',
  'Nikhil',
  'Pooja',
  'Priya',
  'Rahul',
  'Riya',
  'Rohan',
  'Saanvi',
  'Sahil',
  'Sneha',
  'Tanvi',
  'Varun',
  'Vikram',
  'Zara',
  'Aisha',
  'Farhan',
  'Imran',
  'Sana',
  'Joseph',
  'Maria',
  'Daniel',
  'Grace',
  'Harpreet',
  'Gurpreet',
  'Lakshmi',
  'Karthik',
  'Deepa',
  'Suresh',
  'Anjali',
  'Manish',
  'Swati',
  'Rajesh',
  'Divya',
  'Akash',
  'Shreya',
  'Yash',
  'Ira',
  'Kabir',
  'Naina',
  'Omkar',
  'Pallavi',
  'Rehan',
  'Simran',
  'Tushar',
  'Uma',
  'Vivek',
  'Wasim',
  'Yamini',
  'Zubin',
] as const;
const LAST = [
  'Sharma',
  'Verma',
  'Iyer',
  'Nair',
  'Reddy',
  'Rao',
  'Gupta',
  'Mehta',
  'Patel',
  'Shah',
  'Kulkarni',
  'Joshi',
  'Desai',
  'Menon',
  'Pillai',
  'Banerjee',
  'Chatterjee',
  'Mukherjee',
  'Das',
  'Bose',
  'Singh',
  'Kaur',
  'Gill',
  'Khan',
  'Ahmed',
  'Qureshi',
  "D'Souza",
  'Fernandes',
  'Thomas',
  'George',
  'Kapoor',
  'Malhotra',
  'Bhat',
  'Hegde',
  'Shetty',
  'Naidu',
  'Chopra',
  'Saxena',
  'Mishra',
  'Tiwari',
  'Pandey',
  'Agarwal',
  'Jain',
  'Sinha',
] as const;
const RESEARCH: Record<string, string[]> = {
  ENG: [
    'machine learning systems',
    'distributed systems',
    'control theory',
    'materials science',
    'signal processing',
    'structural engineering',
    'robotics',
    'renewable energy',
  ],
  SCI: [
    'molecular genetics',
    'microbial ecology',
    'quantum materials',
    'number theory',
    'organic synthesis',
    'bioinformatics',
  ],
  LAW: [
    'constitutional law',
    'international trade law',
    'intellectual property',
    'environmental law',
  ],
  ART: [
    'postcolonial literature',
    'medieval history',
    'philosophy of mind',
    'sociolinguistics',
    'visual culture',
  ],
  SOC: ['development economics', 'public policy', 'urban sociology'],
  BUS: ['corporate finance', 'consumer behaviour', 'operations research'],
  MED: ['public health', 'clinical epidemiology', 'nursing practice'],
  EDU: ['curriculum design', 'educational technology'],
  ARC: ['sustainable design', 'urban planning'],
};
const asciiSlug = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const DESIGNATION_PLAN: FacultyDesignation[] = [
  'PROFESSOR',
  'ASSOCIATE_PROFESSOR',
  'ASSISTANT_PROFESSOR',
  'ASSISTANT_PROFESSOR',
  'LECTURER',
];

export async function seedPeople(passwordHash: string) {
  const [studentRole, facultyRole, registrar] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { key: 'STUDENT' } }),
    prisma.role.findUniqueOrThrow({ where: { key: 'FACULTY' } }),
    prisma.user.findUnique({ where: { email: 'registrar@ucrams.local' } }),
  ]);
  const departments = await prisma.department.findMany({
    orderBy: { code: 'asc' },
    include: { school: { select: { id: true, code: true } } },
  });
  const now = new Date();

  // ----- faculty -------------------------------------------------------------------
  type FacultySeed = {
    email: string;
    first: string;
    last: string;
    deptId: string;
    designation: FacultyDesignation;
    school: string;
    n: number;
  };
  const facultySeeds: FacultySeed[] = [];
  let facultyNo = 0;
  const usedEmails = new Set<string>();
  for (const d of departments) {
    const count = d.school.code === 'ENG' || d.school.code === 'SCI' ? 5 : 3;
    for (let i = 0; i < count; i += 1) {
      const first = pick(FIRST);
      const last = pick(LAST);
      let email = `${asciiSlug(first)}.${asciiSlug(last)}@northbridge.example.edu`;
      for (let k = 2; usedEmails.has(email); k += 1)
        email = `${asciiSlug(first)}.${asciiSlug(last)}${k}@northbridge.example.edu`;
      usedEmails.add(email);
      facultyNo += 1;
      facultySeeds.push({
        email,
        first,
        last,
        deptId: d.id,
        designation: DESIGNATION_PLAN[i % DESIGNATION_PLAN.length]!,
        school: d.school.code,
        n: facultyNo,
      });
    }
  }
  await prisma.user.createMany({
    data: facultySeeds.map((f) => ({
      email: f.email,
      firstName: f.first,
      lastName: f.last,
      passwordHash,
      status: 'ACTIVE' as const,
      emailVerifiedAt: now,
      passwordChangedAt: now,
    })),
    skipDuplicates: true,
  });
  const facultyUsers = new Map(
    (
      await prisma.user.findMany({
        where: { email: { in: facultySeeds.map((f) => f.email) } },
        select: { id: true, email: true },
      })
    ).map((u) => [u.email, u.id]),
  );
  await prisma.userRole.createMany({
    data: facultySeeds.map((f) => ({
      userId: facultyUsers.get(f.email)!,
      roleId: facultyRole.id,
      scopeType: 'GLOBAL' as const,
    })),
    skipDuplicates: true,
  });
  await prisma.facultyMember.createMany({
    data: facultySeeds.map((f) => ({
      userId: facultyUsers.get(f.email)!,
      employeeNumber: `FAC${String(f.n).padStart(5, '0')}`,
      departmentId: f.deptId,
      designation: f.designation,
      specialization: pick(RESEARCH[f.school] ?? ['interdisciplinary studies']),
      researchInterests: `${pick(RESEARCH[f.school] ?? ['teaching'])}; ${pick(RESEARCH[f.school] ?? ['learning'])}`,
      qualifications: f.designation === 'LECTURER' ? 'M.Tech' : 'Ph.D.',
      officeLocation: `${f.school} Block, Room ${200 + f.n}`,
      officeHours: pick(['Mon & Wed 14:00–16:00', 'Tue & Thu 10:00–12:00', 'Fri 11:00–13:00']),
      maxLoadCredits: f.designation === 'PROFESSOR' ? 9 : 12,
      joinedOn: new Date(Date.UTC(2010 + Math.floor(rand() * 15), Math.floor(rand() * 12), 1)),
    })),
    skipDuplicates: true,
  });

  // Dev faculty account → Computer Science.
  const cs = departments.find((d) => d.code === 'CS')!;
  const devFaculty = await prisma.user.findUnique({ where: { email: 'faculty.cs@ucrams.local' } });
  if (devFaculty) {
    await prisma.facultyMember.upsert({
      where: { userId: devFaculty.id },
      create: {
        userId: devFaculty.id,
        employeeNumber: 'FAC09001',
        departmentId: cs.id,
        designation: 'ASSOCIATE_PROFESSOR',
        specialization: 'Distributed systems',
        researchInterests: 'Distributed systems; database internals',
        qualifications: 'Ph.D. in Computer Science',
        officeLocation: 'ENG Block, Room 118',
        officeHours: 'Tue & Thu 15:00–17:00',
        maxLoadCredits: 12,
      },
      update: {},
    });
  }
  await prisma.idSequence.upsert({
    where: { key: 'faculty' },
    create: { key: 'faculty', value: facultyNo },
    update: {},
  });

  // Heads (first professor) and deans (head of the school's first department), only where unset.
  for (const d of departments) {
    if (d.headId) continue;
    const head = await prisma.facultyMember.findFirst({
      where: { departmentId: d.id, designation: 'PROFESSOR' },
      orderBy: { employeeNumber: 'asc' },
    });
    if (head) await prisma.department.update({ where: { id: d.id }, data: { headId: head.id } });
  }
  const schools = await prisma.school.findMany({
    include: { departments: { orderBy: { code: 'asc' }, select: { headId: true } } },
  });
  for (const s of schools) {
    const dean = s.departments.find((d) => d.headId)?.headId;
    if (!s.deanId && dean)
      await prisma.school.update({ where: { id: s.id }, data: { deanId: dean } });
  }

  // ----- students ------------------------------------------------------------------
  const programs = await prisma.program.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { code: 'asc' },
    include: {
      department: { select: { code: true } },
      degree: { select: { level: true } },
      specializations: { select: { id: true } },
    },
  });
  const fall2025 = await prisma.academicSession.findUnique({ where: { code: 'FALL-2025' } });
  const fall2026 = await prisma.academicSession.findUnique({ where: { code: 'FALL-2026' } });
  type StudentSeed = {
    email: string;
    first: string;
    last: string;
    programId: string;
    specializationId: string | null;
    number: string;
    year: number;
    status: StudentStatus;
    admissionYear: number;
  };
  const studentSeeds: StudentSeed[] = [];
  const sequences = new Map<string, number>();
  for (const p of programs) {
    const perYear =
      p.degree.level === 'DOCTORAL'
        ? 4
        : p.code.startsWith('BTECH')
          ? 22
          : p.degree.level === 'POSTGRADUATE'
            ? 12
            : 16;
    const years = Math.min(Math.ceil(p.durationYears.toNumber()), 5);
    for (let year = 1; year <= years; year += 1) {
      for (let i = 0; i < perYear; i += 1) {
        const first = pick(FIRST);
        const last = pick(LAST);
        const admissionYear = 2026 - (year - 1);
        const prefix = `${String(admissionYear % 100).padStart(2, '0')}${p.department.code}`;
        const seq = (sequences.get(prefix) ?? 0) + 1;
        sequences.set(prefix, seq);
        const number = `${prefix}${String(seq).padStart(4, '0')}`;
        const r = rand();
        const status: StudentStatus = r < 0.02 ? 'ON_LEAVE' : r < 0.03 ? 'SUSPENDED' : 'ACTIVE';
        studentSeeds.push({
          email: `${asciiSlug(first)}.${asciiSlug(last)}.${number.toLowerCase()}@students.northbridge.example.edu`,
          first,
          last,
          programId: p.id,
          specializationId:
            p.specializations.length && year >= 2 ? pick(p.specializations).id : null,
          number,
          year,
          status,
          admissionYear,
        });
      }
    }
  }
  for (let i = 0; i < studentSeeds.length; i += 1000) {
    const chunk = studentSeeds.slice(i, i + 1000);
    await prisma.user.createMany({
      data: chunk.map((s) => ({
        email: s.email,
        firstName: s.first,
        lastName: s.last,
        passwordHash,
        status: s.status === 'SUSPENDED' ? ('SUSPENDED' as const) : ('ACTIVE' as const),
        emailVerifiedAt: now,
        passwordChangedAt: now,
      })),
      skipDuplicates: true,
    });
    const ids = new Map(
      (
        await prisma.user.findMany({
          where: { email: { in: chunk.map((s) => s.email) } },
          select: { id: true, email: true },
        })
      ).map((u) => [u.email, u.id]),
    );
    await prisma.userRole.createMany({
      data: chunk.map((s) => ({
        userId: ids.get(s.email)!,
        roleId: studentRole.id,
        scopeType: 'GLOBAL' as const,
      })),
      skipDuplicates: true,
    });
    await prisma.student.createMany({
      data: chunk.map((s) => ({
        userId: ids.get(s.email)!,
        studentNumber: s.number,
        programId: s.programId,
        specializationId: s.specializationId,
        yearOfStudy: s.year,
        status: s.status,
        cohort: `Batch ${s.admissionYear}`,
        admissionDate: new Date(Date.UTC(s.admissionYear, 7, 1)),
        admissionSessionId:
          s.admissionYear === 2026 ? fall2026?.id : s.admissionYear === 2025 ? fall2025?.id : null,
        phone: `+91 9${String(Math.floor(rand() * 1e9)).padStart(9, '0')}`,
      })),
      skipDuplicates: true,
    });
  }
  for (const [prefix, value] of sequences) {
    await prisma.idSequence.upsert({
      where: { key: `student:${prefix}` },
      create: { key: `student:${prefix}`, value },
      update: {},
    });
  }

  // Dev student account → B.Tech CS, year 2.
  const devStudent = await prisma.user.findUnique({ where: { email: 'student.cs@ucrams.local' } });
  const btechCs = programs.find((p) => p.code === 'BTECH-CS');
  if (devStudent && btechCs) {
    await prisma.student.upsert({
      where: { userId: devStudent.id },
      create: {
        userId: devStudent.id,
        studentNumber: '25CS9001',
        programId: btechCs.id,
        yearOfStudy: 2,
        cohort: 'Batch 2025',
        admissionSessionId: fall2025?.id,
        admissionDate: new Date(Date.UTC(2025, 7, 1)),
        phone: '+91 98450 12345',
        contact: {
          create: {
            personalEmail: 'sara.personal@example.com',
            city: 'Bengaluru',
            country: 'India',
            emergencyContactName: 'Ravi Student',
            emergencyContactPhone: '+91 98450 54321',
            emergencyContactRelation: 'Parent',
          },
        },
      },
      update: {},
    });
  }

  // A few registration holds (only on first seed).
  if (registrar && (await prisma.registrationHold.count()) === 0) {
    const sample = await prisma.student.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { studentNumber: 'asc' },
      take: 60,
    });
    const holds: Array<{ type: HoldType; reason: string }> = [
      { type: 'FINANCIAL', reason: 'Tuition balance outstanding for the previous session.' },
      { type: 'DOCUMENTATION', reason: 'Transfer certificate not yet submitted.' },
      { type: 'ACADEMIC', reason: 'Academic probation review pending with the department.' },
    ];
    await prisma.registrationHold.createMany({
      data: sample
        .filter((_, i) => i % 3 === 0)
        .map((s, i) => ({
          studentId: s.id,
          ...holds[i % holds.length]!,
          placedById: registrar.id,
        })),
    });
  }

  return { faculty: await prisma.facultyMember.count(), students: await prisma.student.count() };
}
