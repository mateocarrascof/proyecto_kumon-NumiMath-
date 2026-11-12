import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { NavController } from '@ionic/angular/lazy';

import { AuthPort } from '../core/auth/auth.port';
import { StudentSummary, TeacherPort } from '../core/teacher/teacher.port';

/** D4: los niños que el docente puede ver. Solo apodo y curso, en el orden que entrega el servidor. */
@Component({
  selector: 'app-teacher-students',
  templateUrl: 'teacher-students.page.html',
  standalone: false,
})
export class TeacherStudentsPage implements OnInit {
  private readonly teacher = inject(TeacherPort);
  private readonly auth = inject(AuthPort);
  private readonly nav = inject(NavController);
  private readonly cdr = inject(ChangeDetectorRef);

  loading = true;
  error = '';
  students: StudentSummary[] = [];

  async ngOnInit(): Promise<void> {
    const result = await this.teacher.listStudents();
    this.loading = false;
    if (result.ok) {
      this.students = result.students;
    } else if (result.reason === 'forbidden') {
      await this.auth.signOut();
      await this.nav.navigateRoot('/docente/login');
      return;
    } else {
      this.error = 'No pude cargar tus alumnos. Revisa tu conexión e inténtalo de nuevo.';
    }
    this.cdr.markForCheck();
  }

  async open(student: StudentSummary): Promise<void> {
    await this.nav.navigateForward(`/docente/alumnos/${student.studentId}`);
  }
}
